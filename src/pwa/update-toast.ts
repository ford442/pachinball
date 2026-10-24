/**
 * "Update ready" prompt for a waiting service worker (#464 item 8).
 *
 * Imported lazily by `register-sw.ts` the first time Workbox reports a waiting
 * worker, so none of it is in the entry chunk. Plain DOM, no game imports. It
 * never takes focus and its buttons act on click only, so Space / Enter held
 * for the flippers cannot accept it mid-ball.
 */

export const UPDATE_TOAST_ID = 'pwa-update-toast'

export interface UpdateToastOptions {
  /** Reload into the new version. Called at most once per toast. */
  onAccept: () => void
  /** The player chose to keep playing; the next page load prompts again. */
  onLater?: () => void
  doc?: Document
}

/** Show the prompt (replacing an earlier one) and return a function that removes it. */
export function showUpdateToast({ onAccept, onLater, doc = document }: UpdateToastOptions): () => void {
  doc.getElementById(UPDATE_TOAST_ID)?.remove()

  const listeners = new AbortController()
  const root = doc.createElement('div')
  root.id = UPDATE_TOAST_ID
  // The shared .toast look; .toast ignores the pointer, this one has buttons.
  root.className = 'toast show'
  root.style.pointerEvents = 'auto'
  root.style.fontSize = '1rem'
  root.setAttribute('role', 'status')
  root.setAttribute('aria-live', 'polite')

  const text = doc.createElement('span')
  text.textContent = 'Update ready'
  const accept = toastButton(doc, 'Reload')
  const later = toastButton(doc, 'Later')
  root.append(text, accept, later)

  const close = () => {
    listeners.abort()
    root.remove()
  }
  accept.addEventListener('click', () => {
    accept.disabled = true
    later.disabled = true
    text.textContent = 'Updating…'
    listeners.abort()
    onAccept()
  }, { signal: listeners.signal })
  later.addEventListener('click', () => {
    close()
    onLater?.()
  }, { signal: listeners.signal })

  doc.body.appendChild(root)
  return close
}

function toastButton(doc: Document, label: string): HTMLButtonElement {
  const button = doc.createElement('button')
  button.type = 'button'
  button.textContent = label
  Object.assign(button.style, {
    marginLeft: '12px',
    padding: '4px 10px',
    font: 'inherit',
    color: 'inherit',
    background: 'transparent',
    border: '1px solid currentColor',
    borderRadius: '3px',
    cursor: 'pointer',
  })
  return button
}
