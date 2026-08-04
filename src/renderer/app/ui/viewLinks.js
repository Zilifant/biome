/**
 * The two things a visitor wants that are not simulation controls: *which
 * renderer am I looking at*, and *how do I show somebody else this world*.
 *
 * Both are URL facts rather than protocol ones, which is why they live here
 * rather than in `Controls.js`: switching renderer reloads the page with a
 * different query parameter, and sharing a world is a link. Neither sends a
 * command, and neither touches the store.
 *
 * ⚠ The seed comes from the **host** (`/api/status`), never from anything this
 * module remembers. A restart may have been driven from another tab, and
 * `Math.random` is banned in `app/` anyway (`renderer-boundaries.test.js`), so
 * there is no way for presentation to invent a world id — it can only report the
 * one it is told.
 */

/**
 * The current URL's search string with `renderer` and/or `seed` overridden.
 *
 * Pure, so it is testable without a DOM. `null` removes a parameter; anything
 * not named is preserved, which is what keeps `?mode=fixture` alive across a
 * renderer switch.
 *
 * @param {string} search e.g. `window.location.search`
 * @param {{renderer?: string|null, seed?: number|string|null}} overrides
 * @returns {string} a search string including the leading `?`, or ''
 */
export function viewSearch(search, overrides = {}) {
  const params = new URLSearchParams(search);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null || value === undefined) params.delete(key);
    else params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

/**
 * Which renderer the URL asks for, and the one to offer instead.
 * @param {string} search
 * @returns {{current: 'sprite'|'ascii', other: 'sprite'|'ascii'}}
 */
export function rendererChoice(search) {
  const sprite = new URLSearchParams(search).get('renderer') === 'sprite';
  return sprite ? { current: 'sprite', other: 'ascii' } : { current: 'ascii', other: 'sprite' };
}

/**
 * Mount the renderer toggle and the share-this-world control into `host`.
 *
 * @param {HTMLElement} host
 * @param {object} options
 * @param {{getStatus: () => Promise<object>} | null} options.http null in
 *        fixture mode, where there is no host and therefore no world to share
 * @param {Location} [options.location]
 * @param {Navigator} [options.navigator]
 */
export function mountViewLinks(host, { http, location = window.location, navigator = window.navigator }) {
  if (!host) return;

  const { current, other } = rendererChoice(location.search);
  const toggle = document.createElement('a');
  // Switching renderer is a reload rather than a live swap: the grid renderer is
  // chosen once when the app is composed (`createGridRenderer` in main.js), and
  // a link costs nothing next to rebuilding that seam for a control almost
  // nobody uses twice.
  toggle.href = viewSearch(location.search, { renderer: other === 'sprite' ? 'sprite' : null });
  toggle.textContent = other === 'sprite' ? 'switch to sprites' : 'switch to ASCII';
  toggle.title = `Currently showing ${current === 'sprite' ? 'sprites' : 'ASCII glyphs'}`;
  host.append(toggle);

  if (!http) return;

  host.append(document.createTextNode(' · '));
  const share = document.createElement('button');
  share.type = 'button';
  share.className = 'link-button';
  share.textContent = 'copy link to this world';
  share.addEventListener('click', async () => {
    const previous = share.textContent;
    try {
      const status = await http.getStatus();
      const url = `${location.origin}${location.pathname}${viewSearch(location.search, { seed: status.seed })}`;
      await navigator.clipboard.writeText(url);
      share.textContent = 'link copied';
    } catch {
      // Clipboard access can be refused, and a status poll can fail. Neither is
      // worth an alert; say so in place and put the label back.
      share.textContent = 'could not copy';
    }
    setTimeout(() => {
      share.textContent = previous;
    }, 2000);
  });
  host.append(share);
}
