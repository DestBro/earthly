import * as turf from '@turf/turf'
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'
import type {
	MapGeoJSONFeature,
	Map as MapLibreMap,
	MapMouseEvent,
	MapTouchEvent,
} from 'maplibre-gl'
import { HistoryManager } from './managers/HistoryManager'
import { LayerManager } from './managers/LayerManager'
import { RenderingManager } from './managers/RenderingManager'
import { SelectionManager } from './managers/SelectionManager'
import { SnapManager } from './managers/SnapManager'
import { TransformManager } from './managers/TransformManager'
import {
	DrawAnnotationMode,
	DrawLineStringMode,
	DrawPointMode,
	DrawPolygonMode,
} from './modes/DrawMode'
import { EditMode } from './modes/EditMode'
import type {
	EditorEvent,
	EditorEventHandler,
	EditorEventType,
	EditorFeature,
	EditorMode,
	GeoEditorOptions,
} from './types'
import { generateId } from './utils/geometry'

type ScreenPoint = { x: number; y: number }
type PointerOffset = { x: number; y: number }

interface SelectionDragState {
	start: ScreenPoint
	current: ScreenPoint
	hasMoved: boolean
}

type TransformDragType = 'rotate' | 'move'

interface TransformDragState {
	type: TransformDragType
	center: Position
	startPointer: Position
	startBearing?: number
	baseFeatures: EditorFeature[]
	lastFeatures?: EditorFeature[]
	dragPanWasEnabled: boolean
}

export class GeoEditor {
	private map: MapLibreMap
	private options: Required<GeoEditorOptions>
	private mode: EditorMode = 'static'
	private features: Map<string, EditorFeature> = new Map()
	private eventHandlers: Map<EditorEventType, Set<EditorEventHandler>> = new Map()

	// Managers
	public history: HistoryManager
	public snap: SnapManager
	public selection: SelectionManager
	public transform: TransformManager
	public layers: LayerManager
	public rendering: RenderingManager

	// Modes
	private drawPointMode: DrawPointMode
	private drawLineMode: DrawLineStringMode
	private drawPolygonMode: DrawPolygonMode
	private drawAnnotationMode: DrawAnnotationMode
	private editMode: EditMode
	private doubleClickZoomDisabled: boolean = false

	// State
	private selectionDragState?: SelectionDragState
	private selectionDragPanWasEnabled: boolean = true
	private skipClickUntil: number = 0
	private transformDragState?: TransformDragState
	private pointerOffset: PointerOffset
	private panLockEnabled: boolean = false
	private panLockDragPanWasEnabled: boolean = false
	private touchDrawInProgress: boolean = false
	private lastTouchPoint?: ScreenPoint
	private readonly DRAW_MIN_LINE_POINTS = 2
	private readonly DRAW_MIN_POLYGON_POINTS = 3
	private readonly keyDownHandler = this.onKeyDown.bind(this)
	private readonly keyUpHandler = this.onKeyUp.bind(this)
	private readonly gizmoRenderHandler = () => this.renderGizmo()
	private styleChangeRenderScheduled = false
	private readonly scheduleRenderAfterStyleChange = () => {
		if (this.styleChangeRenderScheduled) return
		this.styleChangeRenderScheduled = true
		queueMicrotask(() => {
			this.styleChangeRenderScheduled = false
			this.render()
			if (this.mode === 'edit') this.renderVertices()
		})
	}
	private readonly styleLoadHandler = () => {
		this.layers.setupLayers(() => this.getFeatureCollection())
		this.render()
		if (this.mode === 'edit') this.renderVertices()
		this.setInitialModeIfNeeded()
	}
	private readonly styleDataHandler = () => {
		this.layers.setupLayers(() => this.getFeatureCollection())
		this.scheduleRenderAfterStyleChange()
	}
	private readonly multiSelectModifier: 'ctrl' | 'shift'
	private didSetInitialMode: boolean = false

	constructor(map: MapLibreMap, options: GeoEditorOptions = {}) {
		this.map = map
		this.multiSelectModifier = this.detectMultiSelectModifier()
		this.options = {
			modes: options.modes || ['draw_point', 'draw_linestring', 'draw_polygon', 'edit', 'select'],
			defaultMode: options.defaultMode || 'static',
			features: options.features || ['Point', 'LineString', 'Polygon'],
			snapping: options.snapping ?? true,
			snapDistance: options.snapDistance || 10,
			snapToVertices: options.snapToVertices ?? true,
			snapToEdges: options.snapToEdges ?? true,
			styles: options.styles || {},
			displayControlsDefault: options.displayControlsDefault ?? true,
			touchEnabled: options.touchEnabled ?? true,
			boxSelect: options.boxSelect ?? true,
			clickTolerance: options.clickTolerance || 2,
			pointerOffsetPx: options.pointerOffsetPx ?? { x: 0, y: -44 },
		}
		this.pointerOffset = this.options.pointerOffsetPx

		// Initialize managers
		this.history = new HistoryManager()
		this.snap = new SnapManager(
			this.options.snapDistance,
			this.options.snapToVertices,
			this.options.snapToEdges,
		)
		this.selection = new SelectionManager()
		this.transform = new TransformManager()
		this.layers = new LayerManager()
		this.rendering = new RenderingManager()

		// Initialize modes
		this.drawPointMode = new DrawPointMode()
		this.drawLineMode = new DrawLineStringMode()
		this.drawPolygonMode = new DrawPolygonMode()
		this.drawAnnotationMode = new DrawAnnotationMode()
		this.editMode = new EditMode()

		this.initialize()
	}

	private initialize(): void {
		// Add managers to map
		this.history.onAdd(this.map)
		this.snap.onAdd(this.map)
		this.selection.onAdd(this.map)
		this.transform.onAdd(this.map)
		this.layers.onAdd(this.map)
		this.rendering.onAdd(this.map, this.layers)

		// Add modes
		this.drawPointMode.onAdd(this.map)
		this.drawLineMode.onAdd(this.map)
		this.drawPolygonMode.onAdd(this.map)
		this.drawAnnotationMode.onAdd(this.map)
		this.editMode.onAdd(this.map)

		// Setup layers/sources only once the style is loaded
		this.map.on('style.load', this.styleLoadHandler)
		if (this.layers.isStyleReady()) {
			this.styleLoadHandler()
		}

		// Re-add layers when style changes
		this.map.on('styledata', this.styleDataHandler)

		this.setupEventListeners()
	}

	private setInitialModeIfNeeded(): void {
		if (this.didSetInitialMode) return
		this.didSetInitialMode = true
		queueMicrotask(() => this.setMode(this.options.defaultMode))
	}

	private setupEventListeners(): void {
		this.map.on('click', this.onClick.bind(this))
		this.map.on('dblclick', this.onDoubleClick.bind(this))
		this.map.on('mousemove', this.onMouseMove.bind(this))
		this.map.on('mousedown', this.onMouseDown.bind(this))
		this.map.on('mouseup', this.onMouseUp.bind(this))
		this.map.on('touchstart', this.onTouchStart.bind(this))
		this.map.on('touchmove', this.onTouchMove.bind(this))
		this.map.on('touchend', this.onTouchEnd.bind(this))
		this.map.on('contextmenu', this.onContextMenu.bind(this))
		this.map.on('move', this.gizmoRenderHandler)

		window.addEventListener('keydown', this.keyDownHandler)
		window.addEventListener('keyup', this.keyUpHandler)

		// Set cursor style on hover
		this.map.on('mouseenter', this.layers.LAYER_VERTEX, () => {
			this.map.getCanvas().style.cursor = 'move'
		})
		this.map.on('mouseleave', this.layers.LAYER_VERTEX, () => {
			this.map.getCanvas().style.cursor = ''
		})
		this.map.on('mouseenter', this.layers.LAYER_MIDPOINT, () => {
			this.map.getCanvas().style.cursor = 'pointer'
		})
		this.map.on('mouseleave', this.layers.LAYER_MIDPOINT, () => {
			this.map.getCanvas().style.cursor = ''
		})
		this.map.on('mouseenter', this.layers.LAYER_GIZMO_ROTATE, () => {
			this.map.getCanvas().style.cursor = 'crosshair'
		})
		this.map.on('mouseleave', this.layers.LAYER_GIZMO_ROTATE, () => {
			this.map.getCanvas().style.cursor = ''
		})
		this.map.on('mouseenter', this.layers.LAYER_GIZMO_MOVE, () => {
			this.map.getCanvas().style.cursor = 'move'
		})
		this.map.on('mouseleave', this.layers.LAYER_GIZMO_MOVE, () => {
			this.map.getCanvas().style.cursor = ''
		})
	}

	// ==============================
	// Event Handlers
	// ==============================

	private onClick(e: MapMouseEvent): void {
		if (this.skipClickUntil && Date.now() < this.skipClickUntil) return
		this.skipClickUntil = 0

		if (this.isTouchLikeEvent(e) && this.isDrawMode(this.mode) && !this.panLockEnabled) return

		const { position: clickPoint } = this.getAdjustedPointerPosition(e)
		e.lngLat.lng = clickPoint[0]
		e.lngLat.lat = clickPoint[1]

		if (this.mode === 'draw_point') {
			const feature = this.drawPointMode.onClick(e)
			if (feature) {
				this.addFeature(feature)
				this.emit('create', { type: 'create', features: [feature] })
			}
		} else if (this.mode === 'draw_annotation') {
			const feature = this.drawAnnotationMode.onClick(e)
			if (feature) {
				this.addFeature(feature)
				this.emit('create', { type: 'create', features: [feature] })
				// Auto-select the new annotation so user can immediately edit text
				this.selection.select(feature.id)
				this.render()
			}
		} else if (this.mode === 'draw_linestring') {
			const feature = this.drawLineMode.onClick(e)
			if (feature) {
				this.addFeature(feature)
				this.emit('create', { type: 'create', features: [feature] })
			}
			this.emitDrawChange()
			this.render()
		} else if (this.mode === 'draw_polygon') {
			const feature = this.drawPolygonMode.onClick(e)
			if (feature) {
				this.addFeature(feature)
				this.emit('create', { type: 'create', features: [feature] })
			}
			this.emitDrawChange()
			this.render()
		} else if (this.mode === 'select') {
			this.handleSelectClick(e)
		} else if (this.mode === 'edit') {
			this.handleEditClick(e, clickPoint)
		}
	}

	private handleSelectClick(e: MapMouseEvent): void {
		if (!this.map.getLayer(this.layers.LAYER_FILL)) return
		const features = this.map.queryRenderedFeatures(e.point, {
			layers: [
				this.layers.LAYER_FILL,
				this.layers.LAYER_LINE,
				this.layers.LAYER_POINT,
				this.layers.LAYER_ANNOTATION_ANCHOR,
			],
		})

		if (features.length > 0) {
			const featureId = this.getRenderedFeatureId(features[0])
			if (!featureId) return
			if (!this.isMultiSelectEvent(e.originalEvent)) {
				this.selection.clearSelection()
			}
			this.selection.toggleSelect(featureId)
			this.updateActiveStates()
			this.emit('selection.change', {
				type: 'selection.change',
				features: this.getSelectedFeatures(),
			})
		} else if (!this.isMultiSelectEvent(e.originalEvent)) {
			this.selection.clearSelection()
			this.updateActiveStates()
			this.emit('selection.change', { type: 'selection.change', features: [] })
		}
	}

	private handleEditClick(e: MapMouseEvent, clickPoint: Position): void {
		if (!this.map.getLayer(this.layers.LAYER_VERTEX)) return
		const vertexFeatures = this.map.queryRenderedFeatures(e.point, {
			layers: [this.layers.LAYER_VERTEX, this.layers.LAYER_MIDPOINT],
		})

		if (vertexFeatures.length > 0) {
			const vertex = vertexFeatures[0]
			const meta = vertex.properties?.meta

			if (meta === 'midpoint') {
				const featureId = vertex.properties?.featureId as string
				const path = JSON.parse(vertex.properties?.path as string)
				const feature = this.features.get(featureId)

				if (feature) {
					const updated = this.editMode.insertVertex(feature, path, clickPoint)
					this.updateFeature(featureId, updated)
					this.renderVertices()
				}
			}
		} else {
			if (!this.map.getLayer(this.layers.LAYER_FILL)) return
			const features = this.map.queryRenderedFeatures(e.point, {
				layers: [this.layers.LAYER_FILL, this.layers.LAYER_LINE, this.layers.LAYER_POINT],
			})

			if (features.length > 0) {
				const featureId = this.getRenderedFeatureId(features[0])
				if (!featureId) return
				if (!this.isMultiSelectEvent(e.originalEvent)) {
					this.selection.clearSelection()
				}
				this.selection.toggleSelect(featureId)
				this.updateActiveStates()
				this.renderVertices()
			} else if (!this.isMultiSelectEvent(e.originalEvent)) {
				this.selection.clearSelection()
				this.updateActiveStates()
				this.renderVertices()
			}
		}
	}

	private onMouseDown(e: MapMouseEvent): void {
		if (this.isTouchLikeEvent(e) && this.isDrawMode(this.mode) && !this.panLockEnabled) return

		if (this.mode === 'select') {
			if (this.tryStartTransformDrag(e)) return
			if (this.isMultiSelectEvent(e.originalEvent) && e.originalEvent.button === 0) {
				this.startSelectionDrag(e)
			}
			return
		}

		if (this.mode !== 'edit') return

		if (!this.map.getLayer(this.layers.LAYER_VERTEX)) return
		const vertexFeatures = this.map.queryRenderedFeatures(e.point, {
			layers: [this.layers.LAYER_VERTEX],
		})

		if (vertexFeatures.length > 0) {
			const vertex = vertexFeatures[0]
			const featureId = vertex.properties?.featureId as string
			const path = JSON.parse(vertex.properties?.path as string)

			this.editMode.setDraggingVertex(featureId, path, [e.lngLat.lng, e.lngLat.lat])
			this.map.getCanvas().style.cursor = 'grabbing'
			e.preventDefault()
		}
	}

	private onMouseUp(_e: MapMouseEvent): void {
		if (this.transformDragState) {
			this.finishTransformDrag(true)
			return
		}

		if (this.isTouchLikeEvent(_e as any) && this.isDrawMode(this.mode) && !this.panLockEnabled)
			return

		if (this.mode === 'select') {
			if (this.selectionDragState) this.completeSelectionDrag()
			return
		}

		if (this.mode !== 'edit') return

		const state = this.editMode.getState()
		if (state.draggingVertex) {
			this.editMode.clearDragging()
			this.map.getCanvas().style.cursor = ''
		}
	}

	private onTouchStart(e: MapTouchEvent): void {
		this.touchDrawInProgress = false
		this.lastTouchPoint = { x: e.point.x, y: e.point.y }
		this.onMouseDown(e as unknown as MapMouseEvent)
	}

	private onTouchMove(e: MapTouchEvent): void {
		this.touchDrawInProgress = true
		this.lastTouchPoint = { x: e.point.x, y: e.point.y }
		this.onMouseMove(e as unknown as MapMouseEvent)
	}

	private onTouchEnd(e: MapTouchEvent): void {
		if (
			this.touchDrawInProgress &&
			this.lastTouchPoint &&
			this.panLockEnabled &&
			this.isDrawMode(this.mode)
		) {
			const position = this.getAdjustedPositionFromScreenPoint(this.lastTouchPoint)
			this.handleDrawRelease(position)
		}
		this.touchDrawInProgress = false
		this.lastTouchPoint = undefined
		this.onMouseUp(e as unknown as MapMouseEvent)
	}

	private onDoubleClick(_e: MapMouseEvent): void {
		if (this.mode === 'draw_linestring') {
			const feature = this.drawLineMode.onKeyDown({ key: 'Enter' } as KeyboardEvent)
			if (feature) {
				this.addFeature(feature)
				this.emit('create', { type: 'create', features: [feature] })
				this.render()
			}
		} else if (this.mode === 'draw_polygon') {
			const feature = this.drawPolygonMode.onKeyDown({ key: 'Enter' } as KeyboardEvent)
			if (feature) {
				this.addFeature(feature)
				this.emit('create', { type: 'create', features: [feature] })
				this.render()
			}
		}
	}

	private onMouseMove(e: MapMouseEvent): void {
		if (this.transformDragState) {
			this.handleTransformDrag(e)
			return
		}

		if (this.isTouchLikeEvent(e) && this.isDrawMode(this.mode) && !this.panLockEnabled) return

		if (this.mode === 'select') {
			if (this.selectionDragState) this.updateSelectionDrag(e)
			return
		}

		if (this.shouldShowCursorIndicator()) {
			const { position } = this.getAdjustedPointerPosition(e)
			this.rendering.updateCursorIndicator(position, true)
			if (this.mode === 'draw_linestring' || this.mode === 'draw_polygon') {
				e.lngLat.lng = position[0]
				e.lngLat.lat = position[1]
			}
		} else {
			this.rendering.updateCursorIndicator()
		}

		if (this.mode === 'draw_linestring') {
			this.drawLineMode.onMove(e)
			this.render()
		} else if (this.mode === 'draw_polygon') {
			this.drawPolygonMode.onMove(e)
			this.render()
		} else if (this.mode === 'edit') {
			const state = this.editMode.getState()
			if (state.draggingVertex) {
				const { featureId, coordinatePath } = state.draggingVertex
				const feature = this.features.get(featureId)

				if (feature) {
					const lngLat: Position = [e.lngLat.lng, e.lngLat.lat]
					const snapResult = this.snap.snap(lngLat, this.getSnappableFeatures(), [featureId])
					const newPosition = snapResult.snapped ? snapResult.point : lngLat

					const updated = this.editMode.updateVertexPosition(feature, coordinatePath, newPosition)
					this.features.set(featureId, updated)
					this.render()
					this.renderVertices()
				}
			}
		}
	}

	private onContextMenu(e: MapMouseEvent): void {
		e.preventDefault()

		if (this.mode === 'edit') {
			const vertexFeatures = this.map.queryRenderedFeatures(e.point, {
				layers: [this.layers.LAYER_VERTEX],
			})

			if (vertexFeatures.length > 0) {
				const vertex = vertexFeatures[0]
				const featureId = vertex.properties?.featureId as string
				const path = JSON.parse(vertex.properties?.path as string)
				const feature = this.features.get(featureId)

				if (feature) {
					const updated = this.editMode.removeVertex(feature, path)
					if (updated) {
						this.updateFeature(featureId, updated)
						this.renderVertices()
					}
				}
			}
		}
	}

	private onKeyDown(e: KeyboardEvent): void {
		if (e.key === 'Escape' && this.transformDragState) {
			e.preventDefault()
			this.finishTransformDrag(false)
			return
		}

		if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
			e.preventDefault()
			if (e.shiftKey) {
				this.redo()
			} else {
				this.undo()
			}
			return
		}

		if (
			e.key === 'Delete' ||
			(e.key === 'Backspace' && (this.mode === 'select' || this.mode === 'edit'))
		) {
			const selected = this.getSelectedFeatures()
			if (selected.length > 0) {
				e.preventDefault()
				this.deleteFeatures(selected.map((f: EditorFeature) => f.id))
				return
			}
		}

		if (this.mode === 'draw_linestring') {
			const feature = this.drawLineMode.onKeyDown(e)
			if (feature) {
				this.addFeature(feature)
				this.emit('create', { type: 'create', features: [feature] })
			}
			this.render()
		} else if (this.mode === 'draw_polygon') {
			const feature = this.drawPolygonMode.onKeyDown(e)
			if (feature) {
				this.addFeature(feature)
				this.emit('create', { type: 'create', features: [feature] })
			}
			this.render()
		}
	}

	private onKeyUp(e: KeyboardEvent): void {
		if (e.key === 'Shift' && this.selectionDragState) {
			this.completeSelectionDrag(true)
		}
	}

	// ==============================
	// Selection Drag
	// ==============================

	private startSelectionDrag(e: MapMouseEvent): void {
		if (this.selectionDragState) return

		this.selectionDragState = {
			start: { x: e.point.x, y: e.point.y },
			current: { x: e.point.x, y: e.point.y },
			hasMoved: false,
		}

		this.selectionDragPanWasEnabled = this.map.dragPan.isEnabled()
		if (this.selectionDragPanWasEnabled) this.map.dragPan.disable()

		this.rendering.renderSelectionBox(this.selectionDragState)
	}

	private updateSelectionDrag(e: MapMouseEvent): void {
		if (!this.selectionDragState) return

		this.selectionDragState.current = { x: e.point.x, y: e.point.y }

		if (!this.selectionDragState.hasMoved) {
			const dx = Math.abs(this.selectionDragState.current.x - this.selectionDragState.start.x)
			const dy = Math.abs(this.selectionDragState.current.y - this.selectionDragState.start.y)
			if (dx > 3 || dy > 3) this.selectionDragState.hasMoved = true
		}

		this.rendering.renderSelectionBox(this.selectionDragState)
	}

	private completeSelectionDrag(cancel: boolean = false): void {
		if (!this.selectionDragState) return

		const state = this.selectionDragState
		this.selectionDragState = undefined

		if (this.selectionDragPanWasEnabled) this.map.dragPan.enable()

		const shouldSkipClick = state.hasMoved && !cancel
		this.skipClickUntil = shouldSkipClick ? Date.now() + 100 : 0

		this.rendering.renderSelectionBox()

		if (cancel || !state.hasMoved) return

		const minX = Math.min(state.start.x, state.current.x)
		const minY = Math.min(state.start.y, state.current.y)
		const maxX = Math.max(state.start.x, state.current.x)
		const maxY = Math.max(state.start.y, state.current.y)

		if (!this.map.getLayer(this.layers.LAYER_FILL)) return
		const queriedFeatures = this.map.queryRenderedFeatures(
			[
				[minX, minY],
				[maxX, maxY],
			],
			{
				layers: [
					this.layers.LAYER_FILL,
					this.layers.LAYER_LINE,
					this.layers.LAYER_POINT,
					this.layers.LAYER_ANNOTATION_ANCHOR,
				],
			},
		)

		const featureIds = Array.from(
			new Set(
				queriedFeatures
					.filter((feature) => feature.properties?.meta === 'feature')
					.map((feature) => this.getRenderedFeatureId(feature))
					.filter((id): id is string => typeof id === 'string' && id.length > 0),
			),
		)

		if (featureIds.length > 0) {
			this.selection.select(featureIds)
			this.updateActiveStates()
			this.emit('selection.change', {
				type: 'selection.change',
				features: this.getSelectedFeatures(),
			})
		}
	}

	// ==============================
	// Transform Drag
	// ==============================

	private tryStartTransformDrag(e: MapMouseEvent): boolean {
		if (this.mode !== 'select') return false
		const gizmoFeatures = this.map.queryRenderedFeatures(e.point, {
			layers: [this.layers.LAYER_GIZMO_ROTATE, this.layers.LAYER_GIZMO_MOVE],
		})

		if (gizmoFeatures.length === 0) return false

		const meta = gizmoFeatures[0].properties?.meta
		const pointer: Position = [e.lngLat.lng, e.lngLat.lat]

		if (meta === 'gizmo-rotate') {
			this.startTransformDrag('rotate', pointer)
			e.preventDefault()
			return true
		}
		if (meta === 'gizmo-move') {
			this.startTransformDrag('move', pointer)
			e.preventDefault()
			return true
		}
		return false
	}

	private startTransformDrag(type: TransformDragType, pointer: Position): void {
		const selected = this.getSelectedFeatures()
		if (selected.length === 0) return
		const center = this.getSelectionCentroid(selected)
		if (!center) return

		const baseFeatures = selected.map((feature) => this.cloneFeature(feature))
		const dragPanWasEnabled = this.map.dragPan.isEnabled()
		if (dragPanWasEnabled) this.map.dragPan.disable()

		this.transformDragState = {
			type,
			center,
			startPointer: pointer,
			startBearing: type === 'rotate' ? turf.bearing(center, pointer) : undefined,
			baseFeatures,
			dragPanWasEnabled,
		}
		this.map.getCanvas().style.cursor = 'grabbing'
	}

	private handleTransformDrag(e: MapMouseEvent): void {
		if (!this.transformDragState) return
		const pointer: Position = [e.lngLat.lng, e.lngLat.lat]
		this.updateTransformDrag(pointer)
		e.preventDefault()
	}

	private updateTransformDrag(pointer: Position): void {
		const state = this.transformDragState
		if (!state) return

		let updatedFeatures: EditorFeature[] = []

		if (state.type === 'rotate') {
			const startBearing = state.startBearing ?? turf.bearing(state.center, state.startPointer)
			const currentBearing = turf.bearing(state.center, pointer)
			const angleDelta = currentBearing - startBearing
			updatedFeatures = state.baseFeatures.map((feature) =>
				this.transform.rotate(feature, { center: state.center, angle: angleDelta }),
			)
		} else {
			updatedFeatures = state.baseFeatures.map((feature) =>
				this.transform.move(feature, state.startPointer, pointer),
			)
		}

		updatedFeatures = updatedFeatures.map((feature) => this.normalizeFeature(feature))
		updatedFeatures.forEach((feature) => this.features.set(feature.id, feature))

		state.lastFeatures = updatedFeatures

		if (state.type === 'move') {
			const newCenter = this.getSelectionCentroid(updatedFeatures)
			if (newCenter) state.center = newCenter
		}

		this.render()
	}

	private finishTransformDrag(commit: boolean): void {
		const state = this.transformDragState
		if (!state) return

		this.transformDragState = undefined
		if (state.dragPanWasEnabled) this.map.dragPan.enable()
		this.map.getCanvas().style.cursor = ''

		if (commit && state.lastFeatures && state.lastFeatures.length > 0) {
			this.history.recordUpdate(state.lastFeatures, state.baseFeatures)
			this.emit('update', { type: 'update', features: state.lastFeatures })
			this.render()
		} else if (!commit) {
			state.baseFeatures.forEach((feature) => this.features.set(feature.id, feature))
			this.render()
		} else {
			this.renderGizmo()
		}
	}

	// ==============================
	// Public API Methods
	// ==============================

	setMode(mode: EditorMode): void {
		const previousMode = this.mode
		this.mode = mode

		if (previousMode === 'edit' && mode !== 'edit') {
			this.editMode.reset()
			this.renderVertices()
		}

		if (mode === 'edit') this.renderVertices()

		if (mode !== 'select' && this.selectionDragState) {
			this.completeSelectionDrag(true)
		}

		if (!this.shouldShowCursorIndicator()) {
			this.rendering.updateCursorIndicator()
		}

		this.updateDoubleClickZoomState()
		this.updatePanLockForMode()
		this.updateActiveStates()
		this.emit('mode.change', { type: 'mode.change', mode })
	}

	getMode(): EditorMode {
		return this.mode
	}

	toggleSnapping(): boolean {
		this.options.snapping = !this.options.snapping
		this.snap.setSnapping(this.options.snapping)
		return this.options.snapping
	}

	setSnapping(enabled: boolean): void {
		this.options.snapping = enabled
		this.snap.setSnapping(enabled)
	}

	isSnappingEnabled(): boolean {
		return this.options.snapping
	}

	canFinishDrawing(): boolean {
		if (this.mode === 'draw_linestring') {
			return this.drawLineMode.getCoordinates().length >= this.DRAW_MIN_LINE_POINTS
		}
		if (this.mode === 'draw_polygon') {
			return this.drawPolygonMode.getCoordinates().length >= this.DRAW_MIN_POLYGON_POINTS
		}
		return false
	}

	finishDrawing(): EditorFeature | null {
		if (!this.canFinishDrawing()) return null
		let feature: EditorFeature | null = null
		if (this.mode === 'draw_linestring') {
			feature = this.drawLineMode.onKeyDown({ key: 'Enter' } as KeyboardEvent) ?? null
		} else if (this.mode === 'draw_polygon') {
			feature = this.drawPolygonMode.onKeyDown({ key: 'Enter' } as KeyboardEvent) ?? null
		}
		if (feature) {
			this.addFeature(feature)
			this.emit('create', { type: 'create', features: [feature] })
			this.render()
			this.emitDrawChange()
		}
		return feature
	}

	setPanLocked(enabled: boolean): void {
		if (this.panLockEnabled === enabled) return
		this.panLockEnabled = enabled
		this.updatePanLockForMode()
	}

	isPanLocked(): boolean {
		return this.panLockEnabled
	}

	canCombineSelection(): boolean {
		const selected = this.getSelectedFeatures()
		if (selected.length < 2) return false
		const baseType = this.getBaseGeometryType(selected[0].geometry.type)
		if (!baseType) return false
		return selected.every((feature) => this.getBaseGeometryType(feature.geometry.type) === baseType)
	}

	canSplitSelection(): boolean {
		return this.getSelectedFeatures().some((feature) => this.isMultiGeometry(feature.geometry.type))
	}

	combineSelectedFeatures(): boolean {
		const selected = this.getSelectedFeatures()
		if (selected.length < 2) return false

		const baseType = this.getBaseGeometryType(selected[0].geometry.type)
		if (!baseType) return false
		if (!selected.every((feature) => this.getBaseGeometryType(feature.geometry.type) === baseType))
			return false

		const multiType = this.toMultiGeometryType(baseType)
		if (!multiType) return false

		const parts = selected.flatMap((feature) =>
			this.extractGeometryParts(feature.geometry, baseType),
		)
		if (parts.length === 0) return false

		const template = this.cloneFeature(selected[0])
		const newFeature: EditorFeature = {
			...template,
			id: generateId(),
			geometry: {
				type: multiType,
				coordinates: JSON.parse(JSON.stringify(parts)),
			} as Geometry,
		}

		selected.forEach((feature) => this.features.delete(feature.id))
		const normalizedFeature = this.normalizeFeature(newFeature)
		this.features.set(normalizedFeature.id, normalizedFeature)
		this.selection.clearSelection()
		this.selection.select(normalizedFeature.id)
		this.history.recordUpdate([normalizedFeature], selected)
		this.render()
		if (this.mode === 'edit') this.renderVertices()
		this.emit('selection.change', {
			type: 'selection.change',
			features: this.getSelectedFeatures(),
		})
		this.emit('update', { type: 'update', features: [normalizedFeature] })
		return true
	}

	splitSelectedFeatures(): boolean {
		const selected = this.getSelectedFeatures().filter((feature) =>
			this.isMultiGeometry(feature.geometry.type),
		)
		if (selected.length === 0) return false

		const newFeatures: EditorFeature[] = []

		selected.forEach((feature) => {
			const baseType = this.getBaseGeometryType(feature.geometry.type)
			if (!baseType) return
			const parts = this.extractGeometryParts(feature.geometry, baseType)
			parts.forEach((coords) => {
				const clone = this.cloneFeature(feature)
				clone.id = generateId()
				clone.geometry = {
					type: baseType,
					coordinates: JSON.parse(JSON.stringify(coords)),
				} as Geometry
				newFeatures.push(this.normalizeFeature(clone))
			})
		})

		if (newFeatures.length === 0) return false

		selected.forEach((feature) => this.features.delete(feature.id))
		newFeatures.forEach((feature) => this.features.set(feature.id, feature))
		this.selection.clearSelection()
		this.selection.select(newFeatures.map((feature) => feature.id))
		this.history.recordUpdate(newFeatures, selected)
		this.render()
		if (this.mode === 'edit') this.renderVertices()
		this.emit('selection.change', {
			type: 'selection.change',
			features: this.getSelectedFeatures(),
		})
		this.emit('update', { type: 'update', features: newFeatures })
		return true
	}

	addFeature(feature: EditorFeature): void {
		const normalized = this.normalizeFeature(feature)
		this.features.set(normalized.id, normalized)
		this.history.recordCreate([normalized])
		this.render()
	}

	updateFeature(featureId: string, feature: EditorFeature): void {
		const normalized = this.normalizeFeature(feature)
		const previous = this.features.get(featureId)
		if (previous) this.history.recordUpdate([normalized], [previous])
		this.features.set(featureId, normalized)
		this.render()
		this.emit('update', { type: 'update', features: [normalized] })
	}

	deleteFeature(featureId: string): void {
		this.deleteFeatures([featureId])
	}

	deleteFeatures(featureIds: string[]): void {
		const deleted = featureIds
			.map((id) => this.features.get(id))
			.filter((f): f is EditorFeature => f !== undefined)

		if (deleted.length > 0) {
			this.history.recordDelete(deleted)
			featureIds.forEach((id) => this.features.delete(id))
			this.selection.deselect(featureIds)
			this.updateActiveStates()
			if (this.mode === 'edit') this.renderVertices()
			this.emit('selection.change', {
				type: 'selection.change',
				features: this.getSelectedFeatures(),
			})
			this.emit('delete', { type: 'delete', features: deleted })
		}
	}

	getFeature(featureId: string): EditorFeature | undefined {
		return this.features.get(featureId)
	}

	getAllFeatures(): EditorFeature[] {
		return Array.from(this.features.values())
	}

	selectFeature(featureId: string, additive: boolean = false): void {
		const feature = this.features.get(featureId)
		if (!feature) return
		if (!additive) this.selection.clearSelection()
		this.selection.select(featureId)
		this.updateActiveStates()
		if (this.mode === 'edit') this.renderVertices()
		this.emit('selection.change', {
			type: 'selection.change',
			features: this.getSelectedFeatures(),
		})
	}

	getSelectedFeatures(): EditorFeature[] {
		const selectedIds = this.selection.getSelected()
		return selectedIds
			.map((id) => this.features.get(id))
			.filter((f): f is EditorFeature => f !== undefined)
	}

	setFeatures(features: EditorFeature[]): void {
		this.features.clear()
		features.forEach((feature) => {
			const normalized = this.normalizeFeature(feature)
			this.features.set(normalized.id, normalized)
		})
		this.render()
		if (this.mode === 'edit') this.renderVertices()
	}

	undo(): void {
		const action = this.history.undo()
		if (!action) return

		if (action.type === 'create') {
			action.features.forEach((f: EditorFeature) => this.features.delete(f.id))
		} else if (action.type === 'delete') {
			action.features.forEach((f: EditorFeature) => this.features.set(f.id, f))
		} else if (action.type === 'update' && action.previousFeatures) {
			action.previousFeatures.forEach((f: EditorFeature) => this.features.set(f.id, f))
		}

		this.render()
		if (this.mode === 'edit') this.renderVertices()
		this.emit('undo', { type: 'undo' })
	}

	redo(): void {
		const action = this.history.redo()
		if (!action) return

		if (action.type === 'create') {
			action.features.forEach((f: EditorFeature) => this.features.set(f.id, f))
		} else if (action.type === 'delete') {
			action.features.forEach((f: EditorFeature) => this.features.delete(f.id))
		} else if (action.type === 'update') {
			action.features.forEach((f: EditorFeature) => this.features.set(f.id, f))
		}

		this.render()
		if (this.mode === 'edit') this.renderVertices()
		this.emit('redo', { type: 'redo' })
	}

	on(eventType: EditorEventType, handler: EditorEventHandler): void {
		if (!this.eventHandlers.has(eventType)) {
			this.eventHandlers.set(eventType, new Set())
		}
		this.eventHandlers.get(eventType)?.add(handler)
	}

	off(eventType: EditorEventType, handler: EditorEventHandler): void {
		const handlers = this.eventHandlers.get(eventType)
		if (handlers) handlers.delete(handler)
	}

	getMultiSelectModifierLabel(): string {
		return this.multiSelectModifier === 'ctrl' ? 'Ctrl' : 'Shift'
	}

	destroy(): void {
		try {
			if (this.doubleClickZoomDisabled && this.map.doubleClickZoom) {
				this.map.doubleClickZoom.enable()
				this.doubleClickZoomDisabled = false
			}
			if (this.map.dragPan && !this.map.dragPan.isEnabled()) {
				this.map.dragPan.enable()
			}
		} catch {
			// Map may have been removed
		}

		window.removeEventListener('keydown', this.keyDownHandler)
		window.removeEventListener('keyup', this.keyUpHandler)
		try {
			this.map.off('move', this.gizmoRenderHandler)
			this.map.off('style.load', this.styleLoadHandler)
			this.map.off('styledata', this.styleDataHandler)
		} catch {
			// Map may have been removed
		}

		this.history.onRemove()
		this.snap.onRemove()
		this.selection.onRemove()
		this.transform.onRemove()
		this.layers.removeLayers()
		this.rendering.onRemove()

		this.drawPointMode.onRemove()
		this.drawLineMode.onRemove()
		this.drawPolygonMode.onRemove()
		this.drawAnnotationMode.onRemove()
		this.editMode.onRemove()

		this.features.clear()
		this.eventHandlers.clear()
	}

	// ==============================
	// Private Helper Methods
	// ==============================

	private emit(eventType: EditorEventType, event: EditorEvent): void {
		const handlers = this.eventHandlers.get(eventType)
		if (handlers) handlers.forEach((handler: EditorEventHandler) => handler(event))
	}

	private emitDrawChange(): void {
		this.emit('draw.change', { type: 'draw.change' })
	}

	private getSnappableFeatures(): EditorFeature[] {
		return this.getAllFeatures().filter((feature) => feature.properties?.meta === 'feature')
	}

	private cloneFeature(feature: EditorFeature): EditorFeature {
		return JSON.parse(JSON.stringify(feature)) as EditorFeature
	}

	private normalizeFeature(feature: EditorFeature): EditorFeature {
		feature.properties = {
			...feature.properties,
			meta: feature.properties?.meta ?? 'feature',
			featureId: feature.id,
		}
		return feature
	}

	private updateActiveStates(): void {
		const selectedIds = new Set(this.selection.getSelected())
		this.features.forEach((feature: EditorFeature) => {
			feature.properties = { ...feature.properties, active: selectedIds.has(feature.id) }
		})
		this.render()
	}

	private shouldShowCursorIndicator(): boolean {
		return (
			this.mode === 'draw_point' || this.mode === 'draw_linestring' || this.mode === 'draw_polygon'
		)
	}

	private isDrawMode(mode: EditorMode): boolean {
		return (
			mode === 'draw_point' ||
			mode === 'draw_linestring' ||
			mode === 'draw_polygon' ||
			mode === 'draw_annotation'
		)
	}

	private updateDoubleClickZoomState(): void {
		if (!this.map.doubleClickZoom) return
		const shouldDisable = this.isDrawMode(this.mode)
		if (shouldDisable && !this.doubleClickZoomDisabled) {
			if (this.map.doubleClickZoom.isEnabled()) {
				this.map.doubleClickZoom.disable()
				this.doubleClickZoomDisabled = true
			}
		} else if (!shouldDisable && this.doubleClickZoomDisabled) {
			this.map.doubleClickZoom.enable()
			this.doubleClickZoomDisabled = false
		}
	}

	private updatePanLockForMode(): void {
		if (!this.map.dragPan) return
		const shouldDisablePan = this.panLockEnabled
		if (shouldDisablePan) {
			if (this.map.dragPan.isEnabled()) {
				this.panLockDragPanWasEnabled = true
				this.map.dragPan.disable()
			}
		} else if (this.panLockDragPanWasEnabled && !this.map.dragPan.isEnabled()) {
			this.map.dragPan.enable()
			this.panLockDragPanWasEnabled = false
		}
	}

	private getRenderedFeatureId(feature: MapGeoJSONFeature): string | undefined {
		const propertyId = feature.properties?.featureId
		if (typeof propertyId === 'string' && propertyId.length > 0) return propertyId
		if (typeof propertyId === 'number') return propertyId.toString()
		if (typeof feature.id === 'string') return feature.id
		if (typeof feature.id === 'number') return feature.id.toString()
		return undefined
	}

	private getSelectionCentroid(
		features: EditorFeature[] = this.getSelectedFeatures(),
	): Position | null {
		if (!features.length) return null
		try {
			const fc = turf.featureCollection(features as Feature[])
			const centroid = turf.centerOfMass(fc)
			return centroid.geometry?.coordinates as Position
		} catch {
			return null
		}
	}

	private detectMultiSelectModifier(): 'ctrl' | 'shift' {
		if (typeof navigator !== 'undefined') {
			const platform = navigator.platform || ''
			if (/Mac|iPod|iPhone|iPad/.test(platform)) return 'ctrl'
		}
		return 'shift'
	}

	private isMultiSelectEvent(event: MouseEvent): boolean {
		if (this.multiSelectModifier === 'ctrl') {
			return event.metaKey || event.ctrlKey
		}
		return event.shiftKey
	}

	private applyPointerOffset(point: ScreenPoint): Position {
		const canvas = this.map.getCanvas()
		const maxX = canvas.clientWidth
		const maxY = canvas.clientHeight
		const x = Math.min(Math.max(point.x + this.pointerOffset.x, 0), maxX)
		const y = Math.min(Math.max(point.y + this.pointerOffset.y, 0), maxY)
		const lngLat = this.map.unproject({ x, y })
		return [lngLat.lng, lngLat.lat]
	}

	private isTouchLikeEvent(event: MapMouseEvent | MapTouchEvent): boolean {
		const original = (event as any).originalEvent
		if (!original) return false
		if (typeof (original as any).pointerType === 'string') {
			return (original as any).pointerType === 'touch' || (original as any).pointerType === 'pen'
		}
		if (typeof TouchEvent !== 'undefined' && original instanceof TouchEvent) return true
		if (typeof (original as any).touches === 'object') return true
		return false
	}

	private getAdjustedPointerPosition(
		event: MapMouseEvent,
		excludeFeatureIds: string[] = [],
	): { position: Position; snapped: boolean } {
		const basePosition = this.isTouchLikeEvent(event)
			? this.applyPointerOffset({ x: event.point.x, y: event.point.y })
			: ([event.lngLat.lng, event.lngLat.lat] as Position)
		const snapResult = this.snap.snap(basePosition, this.getSnappableFeatures(), excludeFeatureIds)
		return {
			position: snapResult.snapped ? snapResult.point : basePosition,
			snapped: snapResult.snapped,
		}
	}

	private getAdjustedPositionFromScreenPoint(
		point: ScreenPoint,
		excludeFeatureIds: string[] = [],
	): Position {
		const basePosition = this.applyPointerOffset(point)
		const snapResult = this.snap.snap(basePosition, this.getSnappableFeatures(), excludeFeatureIds)
		return snapResult.snapped ? snapResult.point : basePosition
	}

	private handleDrawRelease(position: Position): void {
		if (this.mode === 'draw_point') {
			const feature = this.drawPointMode.onClick({
				lngLat: { lng: position[0], lat: position[1] },
			} as MapMouseEvent)
			if (feature) {
				this.addFeature(feature)
				this.emit('create', { type: 'create', features: [feature] })
			}
			return
		}

		if (this.mode === 'draw_annotation') {
			const feature = this.drawAnnotationMode.onClick({
				lngLat: { lng: position[0], lat: position[1] },
			} as MapMouseEvent)
			if (feature) {
				this.addFeature(feature)
				this.emit('create', { type: 'create', features: [feature] })
				// Auto-select the new annotation so user can immediately edit text
				this.selection.select(feature.id)
				this.render()
			}
			return
		}

		if (this.mode === 'draw_linestring') {
			const feature = this.drawLineMode.onClick({
				lngLat: { lng: position[0], lat: position[1] },
			} as MapMouseEvent)
			if (feature) {
				this.addFeature(feature)
				this.emit('create', { type: 'create', features: [feature] })
			}
			this.emitDrawChange()
			this.render()
			return
		}

		if (this.mode === 'draw_polygon') {
			const feature = this.drawPolygonMode.onClick({
				lngLat: { lng: position[0], lat: position[1] },
			} as MapMouseEvent)
			if (feature) {
				this.addFeature(feature)
				this.emit('create', { type: 'create', features: [feature] })
			}
			this.emitDrawChange()
			this.render()
		}
	}

	private getBaseGeometryType(type: string): 'Point' | 'LineString' | 'Polygon' | null {
		if (type === 'Point' || type === 'LineString' || type === 'Polygon') return type
		if (type === 'MultiPoint') return 'Point'
		if (type === 'MultiLineString') return 'LineString'
		if (type === 'MultiPolygon') return 'Polygon'
		return null
	}

	private toMultiGeometryType(type: 'Point' | 'LineString' | 'Polygon'): Geometry['type'] | null {
		if (type === 'Point') return 'MultiPoint'
		if (type === 'LineString') return 'MultiLineString'
		if (type === 'Polygon') return 'MultiPolygon'
		return null
	}

	private isMultiGeometry(type: string): boolean {
		return type === 'MultiPoint' || type === 'MultiLineString' || type === 'MultiPolygon'
	}

	private extractGeometryParts(
		geometry: Geometry,
		base: 'Point' | 'LineString' | 'Polygon',
	): any[] {
		if (base === 'Point') {
			if (geometry.type === 'Point') return [geometry.coordinates]
			if (geometry.type === 'MultiPoint') return geometry.coordinates as Position[]
		} else if (base === 'LineString') {
			if (geometry.type === 'LineString') return [geometry.coordinates]
			if (geometry.type === 'MultiLineString') return geometry.coordinates as Position[][]
		} else if (base === 'Polygon') {
			if (geometry.type === 'Polygon') return [geometry.coordinates]
			if (geometry.type === 'MultiPolygon') return geometry.coordinates as Position[][][]
		}
		return []
	}

	// ==============================
	// Rendering Methods
	// ==============================

	private getFeatureCollection(): FeatureCollection {
		const features: Feature[] = Array.from(this.features.values()) as Feature[]
		const currentDrawFeature =
			this.drawLineMode.getCurrentFeature() || this.drawPolygonMode.getCurrentFeature()
		if (currentDrawFeature) features.push(currentDrawFeature as Feature)
		return { type: 'FeatureCollection', features }
	}

	private render(): void {
		this.rendering.render(this.getFeatureCollection())
		this.rendering.renderSelectionIndicator(this.getSelectedFeatures())
		this.renderGizmo()
	}

	private renderGizmo(): void {
		const center = this.getSelectionCentroid()
		this.rendering.renderGizmo(this.mode, center, this.transformDragState?.center)
	}

	private renderVertices(): void {
		this.rendering.renderVertices(
			this.mode,
			this.getAllFeatures(),
			(feature) => this.editMode.extractVerticesWithPaths(feature),
			(feature) => this.editMode.extractMidpoints(feature),
		)
	}
}
