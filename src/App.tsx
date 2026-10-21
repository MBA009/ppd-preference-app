import { HashRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { HouseholdProvider, useHousehold } from './state/data'
import { BottomNav, Loading } from './components/ui'
import Home from './screens/Home'
import Scan from './screens/Scan'
import Preview from './screens/Preview'
import NewDevice from './screens/NewDevice'
import FlowDetail from './screens/FlowDetail'
import Library from './screens/Library'
import DeviceDetail from './screens/DeviceDetail'
import Rules from './screens/Rules'
import RuleEditor from './screens/RuleEditor'
import Questionnaire from './screens/Questionnaire'
import Sources from './screens/Sources'
import Dev from './screens/Dev'

/** Until the household has answered the questions, the only screens are the questions themselves and the test tools. */
function OnboardingGate() {
  const { household } = useHousehold()
  const { pathname } = useLocation()
  if (!household) return <Loading />
  const onboarding = household.answers === null
  if (onboarding && pathname !== '/rules' && pathname !== '/rules/sources' && pathname !== '/dev') return <Navigate to="/rules" replace />
  return <Outlet />
}

function WithTabs() {
  const { household } = useHousehold()
  return (
    <>
      <Outlet />
      {household?.answers !== null && <BottomNav />}
    </>
  )
}

export default function App() {
  return (
    <HashRouter>
      <HouseholdProvider>
        <div className="app">
          <Routes>
            <Route element={<OnboardingGate />}>
              <Route element={<WithTabs />}>
                <Route index element={<Home />} />
                <Route path="scan" element={<Scan />} />
                <Route path="rules" element={<Rules />} />
              </Route>
              <Route path="rules/update" element={<Questionnaire retake />} />
              <Route path="rules/sources" element={<Sources />} />
              <Route path="rules/new" element={<RuleEditor />} />
              <Route path="rules/:ruleId" element={<RuleEditor />} />
              <Route path="preview/:id" element={<Preview />} />
              <Route path="library" element={<Library />} />
              <Route path="device/:id" element={<DeviceDetail />} />
              <Route path="device/:id/joined" element={<NewDevice />} />
              <Route path="device/:id/flow/:flowId" element={<FlowDetail />} />
              <Route path="dev" element={<Dev />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </HouseholdProvider>
    </HashRouter>
  )
}
