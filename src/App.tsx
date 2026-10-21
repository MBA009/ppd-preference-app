import { HashRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { HouseholdProvider, useHousehold } from './state/data'
import { BottomNav, ErrorBox, Loading, SideRail } from './components/ui'
import { Split } from './components/Split'
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
import SystemStatus from './screens/SystemStatus'

/** Until the household has answered the questions, the only screens are the questions themselves and the test tools. */
function OnboardingGate() {
  const { household, error, reload } = useHousehold()
  const { pathname } = useLocation()
  if (!household && error) {
    return (
      <div className="sf">
        <ErrorBox error={error} />
        <button className="btn" onClick={reload}>Try again</button>
      </div>
    )
  }
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

/** On desktop the navigation is a rail beside every screen; on phones the tab bar stays on the tab screens. */
function Shell() {
  const { household } = useHousehold()
  return (
    <>
      {household && household.answers !== null && <SideRail />}
      <main className="main"><Outlet /></main>
    </>
  )
}

/** Household rules beside the rule editor on desktop, once the questions are answered. */
function RulesSplit({ mode }: { mode: 'list' | 'detail' }) {
  const { household } = useHousehold()
  if (!household || household.answers === null) return mode === 'list' ? <Rules /> : <RuleEditor />
  return <Split mode={mode} list={<Rules />} detail={mode === 'detail' ? <RuleEditor /> : null} placeholder="Pick a rule to see or change it." />
}

export default function App() {
  return (
    <HashRouter>
      <HouseholdProvider>
        <div className="app">
          <Routes>
            <Route element={<Shell />}>
              <Route element={<OnboardingGate />}>
                <Route element={<WithTabs />}>
                  <Route index element={<Split mode="list" list={<Home />} detail={null} placeholder="Pick a device to see what it does with your data." />} />
                  <Route path="scan" element={<Scan />} />
                  <Route path="rules" element={<RulesSplit mode="list" />} />
                </Route>
                <Route path="rules/update" element={<Questionnaire retake />} />
                <Route path="rules/sources" element={<Sources />} />
                <Route path="rules/new" element={<RulesSplit mode="detail" />} />
                <Route path="rules/:ruleId" element={<RulesSplit mode="detail" />} />
                <Route path="preview/:id" element={<Preview />} />
                <Route path="library" element={<Library />} />
                <Route path="status" element={<SystemStatus />} />
                <Route path="device/:id" element={<Split mode="detail" list={<Home />} detail={<DeviceDetail />} />} />
                <Route path="device/:id/joined" element={<NewDevice />} />
                <Route path="device/:id/flow/:flowId" element={<FlowDetail />} />
                <Route path="dev" element={<Dev />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </div>
      </HouseholdProvider>
    </HashRouter>
  )
}
