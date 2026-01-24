import { GeoEditorView } from './features/geo-editor/GeoEditorView'
import { Toaster } from './components/ui/sonner'
import './index.css'

export function App() {
	return (
		<>
			<GeoEditorView />
			<Toaster position="bottom-right" />
		</>
	)
}

export default App
