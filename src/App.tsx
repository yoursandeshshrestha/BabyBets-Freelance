import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import { useSystemSettings } from './hooks/useSystemSettings'
import Homepage from './pages/Client/Homepage/Homepage'
import CompetitionsPage from './pages/Client/Competitions/Competitions'
import CompetitionEntry from './pages/Client/CompetitionEntry/CompetitionEntry'
import Checkout from './pages/Client/Checkout/Checkout'
import Payment3DS from './pages/Client/Payment3DS/Payment3DS'
import PaymentReturn from './pages/Client/PaymentReturn/PaymentReturn'
import PaymentSuccess from './pages/Client/PaymentSuccess/PaymentSuccess'
import SignIn from './pages/Client/signin/SignIn'
import SignUp from './pages/Client/signup/SignUp'
import AuthCallback from './pages/Client/AuthCallback/AuthCallback'
import ResetPassword from './pages/Client/ResetPassword'
import VerifyEmail from './pages/Client/VerifyEmail'
import Account from './pages/Client/Account/Account'
import ScratchReveal from './pages/Client/ScratchReveal'
import HowItWorks from './pages/Client/HowItWorks/HowItWorks'
import FAQ from './pages/Client/FAQ/FAQ'
import Contact from './pages/Client/Contact/Contact'
import PrivacyPolicy from './pages/Client/Legal/PrivacyPolicy'
import Terms from './pages/Client/Legal/Terms'
import AcceptableUsePolicy from './pages/Client/Legal/AcceptableUsePolicy'
import WebsiteTerms from './pages/Client/Legal/WebsiteTerms'
import FreePostalEntry from './pages/Client/Legal/FreePostalEntry'
import Partners from './pages/Client/Partners/Partners'
import PartnerProfile from './pages/Client/PartnerProfile/PartnerProfile'
import Founders from './pages/Client/Founders/Founders'
import WinnersGallery from './pages/Client/Winners/Winners'
import MaintenanceMode from './pages/MaintenanceMode/MaintenanceMode'
import Dashboard from './pages/Admin/Dashboard/Dashboard'
import Influencers from './pages/Admin/Influencers'
import Settings from './pages/Admin/Settings/Settings'
import SystemSettings from './pages/Admin/Settings/SystemSettings'
import Analytics from './pages/Admin/Analytics'
import Competitions from './pages/Admin/Competitions'
import CompetitionForm from './pages/Admin/Competitions/CompetitionForm'
import CompetitionDetail from './pages/Admin/Competitions/CompetitionDetail'
import Prizes from './pages/Admin/Prizes/Prizes'
import Users, { UserDetail } from './pages/Admin/Users'
import PromoCodes from './pages/Admin/PromoCodes'
import Winners, { WinnerDetail } from './pages/Admin/Winners'
import Fulfillments from './pages/Admin/Fulfillments'
import Withdrawals from './pages/Admin/Withdrawals'
import InfluencerSales from './pages/Admin/InfluencerSales'
import Activity from './pages/Admin/Activity'
import EmailLogs from './pages/Admin/EmailLogs'
import WheelClaims from './pages/Admin/WheelClaims'
import Assets from './pages/Admin/Assets/Assets'
import Testimonials from './pages/Admin/Testimonials'
import { DashboardLayout } from './pages/Admin/components'
import { AdminRoute, CartDrawer, AppLoading } from './components/common'
import ScrollToTop from './components/common/ScrollToTop'
import { ReferralTracker } from './components/ReferralTracker'
import { CookieConsent } from './components/CookieConsent'
import InfluencerDashboard from './pages/Influencer/Dashboard'
import ProfileEdit from './pages/Influencer/ProfileEdit'
import { Toaster } from 'sonner'

function App() {
  // Check authentication status on mount
  const { user, isLoading: authLoading } = useAuth()

  // Check system settings for maintenance mode
  const { maintenanceMode, loading: settingsLoading } = useSystemSettings()

  // Show loading while checking auth and settings
  if (authLoading || settingsLoading) {
    return <AppLoading />
  }

  // Check if in maintenance mode and user is not admin
  const isInMaintenanceMode = maintenanceMode?.enabled === true
  const isAdmin = user?.isAdmin === true

  // If maintenance mode is on and user is not admin, show maintenance page
  if (isInMaintenanceMode && !isAdmin) {
    return <MaintenanceMode />
  }

  return (
    <BrowserRouter>
      <ScrollToTop />
      <ReferralTracker />
      <Routes>
        <Route path="/" element={<Homepage />} />
        <Route path="/competitions" element={<CompetitionsPage />} />
        <Route path="/competitions/:slug" element={<CompetitionEntry />} />
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/payment-3ds" element={<Payment3DS />} />
        <Route path="/payment-return" element={<PaymentReturn />} />
        <Route path="/payment/success" element={<PaymentSuccess />} />
        <Route path="/login" element={<SignIn />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/auth/reset-password" element={<ResetPassword />} />
        <Route path="/auth/verify-email" element={<VerifyEmail />} />
        <Route path="/account" element={<Account />} />
        <Route path="/scratch-reveal" element={<ScratchReveal />} />
        <Route path="/how-it-works" element={<HowItWorks />} />
        <Route path="/faq" element={<FAQ />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/partners" element={<Partners />} />
        <Route path="/partner/:slug" element={<PartnerProfile />} />
        <Route path="/founders" element={<Founders />} />
        <Route path="/winners" element={<WinnersGallery />} />
        <Route path="/legal/privacy" element={<PrivacyPolicy />} />
        <Route path="/legal/terms" element={<Terms />} />
        <Route path="/legal/website-terms" element={<WebsiteTerms />} />
        <Route path="/legal/acceptable-use" element={<AcceptableUsePolicy />} />
        <Route path="/legal/free-postal-entry" element={<FreePostalEntry />} />
        <Route path="/influencer/dashboard" element={<InfluencerDashboard />} />
        <Route path="/influencer/profile/edit" element={<ProfileEdit />} />
        <Route
          path="/admin/dashboard"
          element={
            <AdminRoute>
              <DashboardLayout />
            </AdminRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="competitions" element={<Competitions />} />
          <Route path="competitions/new" element={<CompetitionForm />} />
          <Route path="competitions/:id" element={<CompetitionDetail />} />
          <Route path="competitions/:id/edit" element={<CompetitionForm />} />
          <Route path="prizes" element={<Prizes />} />
          <Route path="users" element={<Users />} />
          <Route path="users/:id" element={<UserDetail />} />
          <Route path="promo-codes" element={<PromoCodes />} />
          <Route path="winners" element={<Winners />} />
          <Route path="winners/:id" element={<WinnerDetail />} />
          <Route path="influencers" element={<Influencers />} />
          <Route path="influencer-sales" element={<InfluencerSales />} />
          <Route path="fulfillments" element={<Fulfillments />} />
          <Route path="withdrawals" element={<Withdrawals />} />
          <Route path="assets" element={<Assets />} />
          <Route path="testimonials" element={<Testimonials />} />
          <Route path="activity" element={<Activity />} />
          <Route path="email-logs" element={<EmailLogs />} />
          <Route path="wheel-claims" element={<WheelClaims />} />
          <Route path="system-settings" element={<SystemSettings />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
      <CartDrawer />
      <CookieConsent />
      <Toaster position="top-right" richColors />
    </BrowserRouter>
  )
}

export default App