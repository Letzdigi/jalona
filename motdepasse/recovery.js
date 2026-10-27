/**
 * The page a Supabase password-recovery e-mail has to land on.
 *
 * The administrator's only option in the dashboard is *Send password recovery*, which mails a link.
 * Supabase's own documentation is explicit that the link must arrive at a publicly reachable page
 * which reads the token and sets the new password — and no such page existed, because Jalona Construct is a
 * desktop and telephone application with no website. So the one route offered to somebody who had
 * forgotten their password went nowhere, and nobody could fix it through any interface.
 *
 * Deliberately plain: one HTML file and this one script, no framework, no build step, nothing to
 * keep up to date. It is hosted as static files and it has to keep working on a day when nobody
 * remembers it exists.
 *
 * The logic lives here rather than inside a <script> tag so that it can be tested. Everything
 * except `start` is pure; `start` is the only part that touches a document.
 */

/** The shortest password this application will set. Must match SuiteClient.minimumPasswordLength. */
export const MINIMUM_PASSWORD_LENGTH = 10;

/**
 * The project this page talks to: the same publishable pair the application ships.
 *
 * It lives here rather than in a `<script>` tag inside the page on purpose. The page's own
 * Content-Security-Policy is `script-src 'self'`, which forbids inline script — and the first
 * version of this page put its bootstrap inline and was blocked by its own policy. It rendered
 * perfectly and did nothing at all: somebody locked out would have typed a new password, pressed
 * the button and watched nothing happen. No unit test could see that; opening the page did.
 *
 * The key grants nothing on its own. The recovery token in the link is the authority.
 */
export const RECOVERY_CONFIG = {
  url: 'https://xtsghxyomjgwtvgwjjaz.supabase.co',
  key: 'sb_publishable_42lARwvdKHrYIPSOPydgOA_hDs8Ut2f',
};

/**
 * What a recovery link carries, taken from the fragment.
 *
 * Supabase's dashboard e-mail uses the implicit flow: the token arrives after a `#`, which is the
 * one part of a URL a browser never sends to the server. That is the point — the token stays in the
 * page. A link that has expired arrives as `error=...` rather than as nothing, and is told apart,
 * because « le lien a expiré » and « ce n'est pas un lien de récupération » send somebody to two
 * different places.
 */
export function readRecoveryLink(hash) {
  const parameters = new URLSearchParams(String(hash ?? '').replace(/^#/, ''));
  const error = parameters.get('error_description') ?? parameters.get('error');
  if (error) return { ok: false, reason: 'expired', message: decodeURIComponent(error.replace(/\+/g, ' ')) };
  const accessToken = parameters.get('access_token');
  const type = parameters.get('type');
  if (!accessToken) return { ok: false, reason: 'absent' };
  // A session link of another kind would also carry an access_token. Only a recovery is accepted,
  // so this page cannot be used as a general way to set somebody's password from a stray link.
  if (type !== 'recovery') return { ok: false, reason: 'wrong-type' };
  return { ok: true, accessToken };
}

/** The reasons a typed pair is refused, before anything is sent. */
export function validateNewPassword(password, repeated) {
  if (!password) return 'Saisissez un nouveau mot de passe.';
  if (password.length < MINIMUM_PASSWORD_LENGTH) return `Choisissez un mot de passe d’au moins ${MINIMUM_PASSWORD_LENGTH} caractères.`;
  if (password !== repeated) return 'Les deux mots de passe ne correspondent pas.';
  return '';
}

/**
 * Set the password the recovery token belongs to.
 *
 * The token is the authority; there is no old password to prove anything with, which is the whole
 * purpose of a recovery. That is also why the page refuses a link whose `type` is not `recovery`.
 */
export async function setPassword({ origin, key, accessToken, password, fetch: transport = globalThis.fetch }) {
  const response = await transport(`${origin}/auth/v1/user`, {
    method: 'PUT',
    headers: { apikey: key, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (response.ok) return;
  const detail = await response.json().catch(() => ({}));
  const message = detail.msg || detail.message || detail.error_description || '';
  if (response.status === 401 || response.status === 403 || /expired|invalid/i.test(message)) {
    throw new Error('Ce lien a expiré ou a déjà été utilisé. Demandez-en un nouveau à l’administrateur du bureau.');
  }
  if (response.status === 422 && /weak|short|password/i.test(message)) {
    throw new Error('Ce mot de passe est refusé. Choisissez-en un plus long.');
  }
  throw new Error('Le mot de passe n’a pas pu être changé. Réessayez dans quelques instants.');
}

/** Wire the page up. Split out so everything above can be tested without a browser. */
export function start({ document: page, location, history, config, fetch: transport } = {}) {
  const field = id => page.getElementById(id);
  const say = (text, kind = 'error') => {
    const box = field('message');
    box.textContent = text;
    box.className = text ? `message ${kind}` : 'message';
  };
  const link = readRecoveryLink(location.hash);
  // Taken out of the address bar at once: the token is a live credential, and it has no business
  // sitting in a URL that gets shared, bookmarked or screenshotted.
  if (history?.replaceState) history.replaceState(null, '', location.pathname + location.search);

  if (!link.ok) {
    field('form').hidden = true;
    say(link.reason === 'expired'
      ? `Ce lien n’est plus valable. Demandez un nouveau lien à l’administrateur du bureau. (${link.message})`
      : link.reason === 'wrong-type'
        ? 'Ce lien n’est pas un lien de récupération de mot de passe.'
        : 'Ouvrez cette page depuis le lien reçu par e-mail. Sans ce lien, il n’y a rien à changer ici.');
    return;
  }

  field('form').addEventListener('submit', async event => {
    event.preventDefault();
    const password = field('password').value;
    const refused = validateNewPassword(password, field('repeat').value);
    if (refused) { say(refused); return; }
    field('submit').disabled = true;
    say('Changement en cours…', 'working');
    try {
      await setPassword({ origin: config.url, key: config.key, accessToken: link.accessToken, password, fetch: transport });
      field('form').hidden = true;
      say('Mot de passe changé. Il vaut dans Jalona Construct comme dans Jalona Office : connectez-vous avec le nouveau mot de passe.', 'done');
    } catch (error) {
      say(error instanceof Error ? error.message : String(error));
      field('submit').disabled = false;
    }
  });
}

/*
 * Start as soon as this module is loaded by the page, and not when it is imported by a test.
 *
 * The page carries one script tag, `<script type="module" src="./recovery.js">`, because its own
 * policy allows exactly that and no inline script.
 */
if (typeof document !== 'undefined' && document.getElementById('form')) {
  start({ document, location: window.location, history: window.history, config: RECOVERY_CONFIG });
}
