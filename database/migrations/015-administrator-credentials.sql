-- Password credentials for administrator sign-in.
--
-- Until now the only way to obtain an administrator session was to run a CLI
-- that signed one, then paste the result into a build-time environment
-- variable. Vite inlines that value into the JavaScript bundle, so the token
-- was readable by anyone who could fetch the built asset, and it could not be
-- revoked without rotating the signing secret for everyone.
--
-- Credentials live in their own table rather than on chime_app.users because
-- they have a different lifecycle and sensitivity, and because users.auth_subject
-- shows an external identity provider is the intended long-term path. A user
-- may end up with one, the other, or neither.
--
-- No credential is stored in this repository. Set one with:
--   cd server && npm run set-password

BEGIN;

CREATE TABLE IF NOT EXISTS chime_app.user_credentials (
  user_id uuid PRIMARY KEY REFERENCES chime_app.users(id) ON DELETE CASCADE,

  -- Encoded as scrypt$N$r$p$salt_b64$hash_b64 so the work factors travel with
  -- the hash and can be raised later without invalidating existing passwords.
  password_hash text NOT NULL,

  -- Throttling. Counted per user rather than per IP so a distributed attempt
  -- against one account is still slowed.
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until timestamptz,

  last_signed_in_at timestamptz,
  password_updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS touch_user_credentials_updated_at ON chime_app.user_credentials;
CREATE TRIGGER touch_user_credentials_updated_at
BEFORE UPDATE ON chime_app.user_credentials
FOR EACH ROW EXECUTE FUNCTION chime_app.touch_updated_at();

COMMIT;
