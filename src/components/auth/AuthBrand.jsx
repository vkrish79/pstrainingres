// The "PS / pstrainingres / Training resources" block at the top of every
// sign-in card. One copy, so the auth pages cannot drift apart.
export default function AuthBrand() {
  return (
    <div className="auth-brand">
      <div className="auth-brand-mark">PS</div>
      <div>
        <div className="auth-brand-title">pstrainingres</div>
        <div className="auth-brand-sub">Training resources</div>
      </div>
    </div>
  );
}
