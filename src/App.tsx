import { HashRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { HouseholdProvider } from './state/data'
import { BottomNav } from './components/ui'
import Home from './screens/Home'
import Scan from './screens/Scan'
import Preview from './screens/Preview'
import NewDevice from './screens/NewDevice'
import FlowDetail from './screens/FlowDetail'
import Library from './screens/Library'
import DeviceDetail from './screens/DeviceDetail'
import Rules from './screens/Rules'
import Dev from './screens/Dev'

function WithTabs() {
  return (
    <>
      <Outlet />
      <BottomNav />
    </>
  )
}

export default function App() {
  return (
    <HashRouter>
      <HouseholdProvider>
        <div className="app">
          <Routes>
            <Route element={<WithTabs />}>
              <Route index element={<Home />} />
              <Route path="scan" element={<Scan />} />
              <Route path="rules" element={<Rules />} />
            </Route>
            <Route path="preview/:id" element={<Preview />} />
            <Route path="library" element={<Library />} />
            <Route path="device/:id" element={<DeviceDetail />} />
            <Route path="device/:id/joined" element={<NewDevice />} />
            <Route path="device/:id/flow/:flowId" element={<FlowDetail />} />
            <Route path="dev" element={<Dev />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </HouseholdProvider>
    </HashRouter>
  )
}
