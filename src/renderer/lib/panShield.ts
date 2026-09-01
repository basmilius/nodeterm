/**
 * An Electron `<webview>` is a separate process, so a pointer or wheel event landing on the guest
 * never reaches the embedder: a pan that crosses a browser node stalls at its edge while the page
 * under the cursor scrolls instead. While the camera moves, the flow wrapper carries
 * {@link PAN_SHIELD_CLASS} and CSS takes every {@link WEBVIEW_HOST_CLASS} out of hit-testing, so
 * those events reach React Flow's pane.
 *
 * Hit-testing is dropped on the CONTAINER, not the `<webview>`: the container is also the
 * `nowheel` element, so shielding the guest alone would leave the wheel on a surface that still
 * refuses to pan.
 */
export const PAN_SHIELD_CLASS = 'is-panning'

/** Marks the element wrapping a `<webview>`: what the shield takes out of hit-testing. */
export const WEBVIEW_HOST_CLASS = 'webview-host'
