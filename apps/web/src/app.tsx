import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Account } from './account';
import { Protected, SessionProvider, Shell, useSession, homeFor } from './auth';
import { PassengerDashboard, PassengerHistory } from './passenger';
import { DriverDashboard, DriverHistory } from './driver';

function Landing() {
  const { user, loading } = useSession();
  if (loading) return <main className="centered"><p role="status">Restoring your session…</p></main>;
  return <Navigate to={user ? homeFor(user.role) : '/signin'} replace />;
}

export function App() {
  return <BrowserRouter><SessionProvider><Shell><Routes>
    <Route path="/" element={<Landing />} />
    <Route path="/signin" element={<Account mode="signin" />} />
    <Route path="/signup" element={<Account mode="signup" />} />
    <Route element={<Protected role="PASSENGER" />}>
      <Route path="/passenger" element={<PassengerDashboard />} />
      <Route path="/passenger/history" element={<PassengerHistory />} />
    </Route>
    <Route element={<Protected role="DRIVER" />}>
      <Route path="/driver" element={<DriverDashboard />} />
      <Route path="/driver/history" element={<DriverHistory />} />
    </Route>
    <Route path="*" element={<Landing />} />
  </Routes></Shell></SessionProvider></BrowserRouter>;
}
