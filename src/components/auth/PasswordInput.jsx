import { useState } from 'react';

// A password box with Show / Hide. Every other prop goes straight to the
// <input>, so it drops in wherever a type="password" input was.
//
// The toggle is type="button" on purpose: inside a <form> a bare <button>
// submits, and the first click on Show would sign the person in (or fail to).
export default function PasswordInput({ className = '', ...inputProps }) {
  const [shown, setShown] = useState(false);
  return (
    <span className={`pw-field ${className}`}>
      <input {...inputProps} type={shown ? 'text' : 'password'} />
      <button
        type="button"
        className="pw-toggle"
        onClick={() => setShown(s => !s)}
        aria-pressed={shown}
        aria-label={shown ? 'Hide password' : 'Show password'}
      >
        {shown ? 'Hide' : 'Show'}
      </button>
    </span>
  );
}
