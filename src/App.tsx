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
import Onboarding from './screens/Onboarding'
import ChoosePreset from './screens/ChoosePreset'
import Sources from './screens/Sources'
import Dev from './screens/Dev'
import SystemStatus from './screens/SystemStatus'
import DemoDevices from './screens/DemoDevices'
import MakerCloud from './screens/MakerCloud'

/** Until the household has a preset, the only screens are the onboarding questions, the presets and the test tools. */
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
  const onboarding = household.preset_id === null
  if (onboarding && !['/rules', '/rules/sources', '/rules/presets', '/dev'].includes(pathname)) return <Navigate to="/rules" replace />
  return <Outlet />
}

function WithTabs() {
  const { household } = useHousehold()
  return (
    <>
      <Outlet />
      {!!household?.preset_id && <BottomNav />}
    </>
  )
}

/** On desktop the navigation is a rail beside every screen; on phones the tab bar stays on the tab screens. */
function Shell() {
  const { household } = useHousehold()
  return (
    <>
      {!!household?.preset_id && <SideRail />}
      <main className="main"><Outlet /></main>
    </>
  )
}

/** Household rules beside the rule editor on desktop, once the household has a preset. */
function RulesSplit({ mode }: { mode: 'list' | 'detail' }) {
  const { household } = useHousehold()
  if (!household?.preset_id) return mode === 'list' ? <Rules /> : <RuleEditor />
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
                <Route path="rules/update" element={<Onboarding retake />} />
                <Route path="rules/presets" element={<ChoosePreset />} />
                <Route path="rules/sources" element={<Sources />} />
                <Route path="rules/new" element={<RulesSplit mode="detail" />} />
                <Route path="rules/:ruleId" element={<RulesSplit mode="detail" />} />
                <Route path="preview/:id" element={<Preview />} />
                <Route path="library" element={<Library />} />
                <Route path="status" element={<SystemStatus />} />
                <Route path="demo-devices" element={<DemoDevices />} />
                <Route path="maker" element={<MakerCloud />} />
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
