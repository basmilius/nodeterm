import { useEffect, useRef, useState } from 'react'
import { Tooltip } from '../components/Tooltip'
import { IconClose, IconOpenExternal, IconReload } from '../components/icons'
import { Handle, NodeResizer, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { NODE_MIN_SIZES } from '../lib/nodeSizing'
import { PAGE_HEIGHT_EXPRESSION, webNodeFitHeight } from '../lib/webNodeFit'
import { webNodeBounds } from '../state/workspace'
import type { CanvasNode } from '../state/workspace'
import { httpUrl } from './webUrl'
import { useDiscardWhenHidden, webviewAudible, type AudibleWebview } from './useDiscardWhenHidden'
import { DiscardedPlate } from './DiscardedPlate'
import { reloadWebview, type ReloadableWebview } from './webviewReload'
import { describeLoadFailure, isReportableFailure, type WebviewLoadFailure } from './webviewError'
import { WebviewErrorPlate } from './WebviewErrorPlate'
import { WebviewLoadingBar } from './WebviewLoadingBar'
import { useWebviewKeepAlive } from '../state/webviewKeepAlive'
import { markWorkspaceDirty } from '../state/workspaceDirty'

/**
 * A web view node. When `data.url` is set it loads that live URL; otherwise it serves the
 * local html at `data.filePath` over the `nt-media://` protocol (allowlisted on mount via
 * `media.allow`). Rendered in an Electron `<webview>` kept locked down (no `nodeintegration`).
 * The frame/header mirror {@link VideoNode}/EditorNode for consistent drag/resize/close behavior.
 */
export default function WebNode({ id, data, selected }: NodeProps<CanvasNode>) {
  const { deleteElements, setNodes } = useReactFlow()
  const [src, setSrc] = useState('')
  /** We never got as far as handing the guest a source: an unusable scheme, or a media grant that
   *  was refused. Distinct from `failure`, which is a page that was attempted and did not load. */
  const [error, setError] = useState('')
  const [failure, setFailure] = useState<WebviewLoadFailure | null>(null)
  const [loading, setLoading] = useState(false)
  const url = (data.url as string) ?? ''
  const filePath = (data.filePath as string) ?? ''
  const title = (data.title as string) || url || filePath.split('/').pop() || 'web'
  const rootRef = useRef<HTMLDivElement | null>(null)
  /** Whether this node still owes itself a grow-to-fit. A ref, not state: the load handler reads it
   *  and clears it in the same turn, and a re-render in between would fit twice. */
  const fitPendingRef = useRef(data.fitToContent === true)
  /** The guest, for the audible check only — a local html page can hold a playing <video>. */
  const wvRef = useRef<(AudibleWebview & ReloadableWebview) | null>(null)
  // Memory saver — the same shared hook {@link BrowserSurface} uses: hidden long enough, the
  // <webview> is unmounted (its Chromium process exits) and rebuilt on reveal. `revive` is what
  // re-runs the source effect below, so the `nt-media://` grant is re-issued for a local file
  // exactly as it was at mount. `srcRef` mirrors `src` for the hook's fire-time content check.
  const [discarded, setDiscarded] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [revive, setRevive] = useState(0)
  const srcRef = useRef('')
  /** The media grant being in flight — the only await between mount and a usable src (a live URL
   *  is resolved synchronously). Discarding mid-grant would drop the answer to a request already
   *  made. */
  const grantingRef = useRef(false)
  /** The guest's own navigation, mirrored for the same fire-time read: the hook asks from a
   *  callback that must not force the observer to be re-created. */
  const loadingRef = useRef(false)

  useEffect(() => {
    let alive = true
    // `settled` ends the restore plate (see `restoring`): the source effect has produced an
    // outcome — a src, an error, or nothing to load at all. Without the last case a node whose
    // url/filePath vanished while it was hidden would sit under the plate forever.
    const settled = (): void => {
      if (alive) setRestoring(false)
    }
    if (url) {
      const safe = httpUrl(url)
      if (safe) {
        setSrc(safe)
        srcRef.current = safe
      } else {
        setError('Unsupported URL scheme — only http/https')
      }
      settled()
    } else if (filePath) {
      grantingRef.current = true
      window.nodeTerminal.media
        .allow(filePath)
        .then((mediaUrl) => {
          grantingRef.current = false
          if (alive) {
            setSrc(mediaUrl)
            srcRef.current = mediaUrl
          }
          settled()
        })
        .catch(() => {
          grantingRef.current = false
          if (alive) setError('Couldn’t load this page.')
          settled()
        })
    } else {
      settled()
    }
    return () => {
      alive = false
    }
  }, [url, filePath, revive])

  // One definition of "there is a guest right now", read by both the reload button and the body:
  // the button must appear exactly when there is something to reload, and a second copy of the
  // condition is what would let those two drift.
  const live = !!src && !discarded && !restoring

  /**
   * Grow the node to the height its page needs, ONCE, on the first load after it was created.
   *
   * `data.fitToContent` is set by `createWebNode` and is not serialized, so the window it is true
   * in is exactly "this node was just opened and has not been looked at yet". A node the user has
   * since resized, or one restored from disk, never carries it and is never touched again.
   *
   * The chrome around the guest is MEASURED (`offsetHeight`, which the canvas transform does not
   * scale) rather than assumed, so changing the node's header cannot silently start cutting pages
   * off. Every failure answers "leave it alone": no webview, no `executeJavaScript` (there is none
   * outside Electron, so the Server Edition keeps the size it opened at), a guest that throws, or a
   * measurement `webNodeFitHeight` cannot use.
   */
  const fitToPage = async (): Promise<void> => {
    // A background keep-alive GHOST is not in the canvas `setNodes` addresses, and resizing one
    // would mean nothing anyway: it is parked at the origin behind `display:none`. A node cannot
    // be a ghost on its first load, so this only ever guards a future caller.
    if (!fitPendingRef.current || data.ghost === true) return
    const wv = wvRef.current as unknown as
      | { executeJavaScript?: (code: string) => Promise<unknown>; offsetHeight?: number }
      | null
    const root = rootRef.current
    if (!wv?.executeJavaScript || !root || !wv.offsetHeight) return
    fitPendingRef.current = false
    let pageHeight = 0
    try {
      pageHeight = Number(await wv.executeJavaScript(PAGE_HEIGHT_EXPRESSION))
    } catch {
      return
    }
    const currentHeight = root.offsetHeight
    const next = webNodeFitHeight({
      pageHeight,
      chromeHeight: currentHeight - wv.offsetHeight,
      currentHeight,
      maxHeight: webNodeBounds().maxHeight,
      minHeight: NODE_MIN_SIZES.web.height
    })
    if (next === null) return
    setNodes((nodes) =>
      nodes.map((node) =>
        node.id === id
          ? {
              ...node,
              height: next,
              style: { ...node.style, height: next },
              // Same three rules `withNodeRect` follows for every other programmatic resize:
              // drop the stale measurement (flowToNodeStates prefers `measured` over `height`, so
              // a commit racing the re-measure would persist the old size), keep
              // `expandedHeight` in step (it is what collapse restores to), and mark the workspace
              // dirty below because a direct setNodes bypasses handleNodesChange.
              measured: undefined,
              data: { ...node.data, expandedHeight: next, fitToContent: undefined }
            }
          : node
      )
    )
    markWorkspaceDirty()
  }

  // The guest's own load lifecycle. Without it a node whose page refuses the connection sits on
  // Chromium's error page behind our chrome, saying nothing the node can act on. `live` is the dep
  // because that is exactly when the element mounts and unmounts; a src change reuses it.
  useEffect(() => {
    const wv = wvRef.current as unknown as (EventTarget & { addEventListener: HTMLElement['addEventListener'] }) | null
    if (!wv || !live) return
    const onStart = (): void => {
      loadingRef.current = true
      setLoading(true)
      // A new attempt is the only thing that clears the plate — see BrowserSurface's `onStart`.
      setFailure(null)
    }
    const onStop = (): void => {
      loadingRef.current = false
      setLoading(false)
      void fitToPage()
    }
    const onFail = (e: Event): void => {
      const ev = e as unknown as {
        isMainFrame: boolean
        errorCode: number
        errorDescription: string
        validatedURL?: string
      }
      if (isReportableFailure(ev.isMainFrame, ev.errorCode)) {
        setFailure(describeLoadFailure(ev.errorCode, ev.errorDescription, ev.validatedURL || srcRef.current))
      }
    }
    wv.addEventListener('did-start-loading', onStart)
    wv.addEventListener('did-stop-loading', onStop)
    wv.addEventListener('did-fail-load', onFail)
    return () => {
      wv.removeEventListener('did-start-loading', onStart)
      wv.removeEventListener('did-stop-loading', onStop)
      wv.removeEventListener('did-fail-load', onFail)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live])

  useDiscardWhenHidden(rootRef, {
    isLoading: () => grantingRef.current || loadingRef.current,
    isAudible: () => webviewAudible(wvRef.current),
    hasContent: () => !!srcRef.current,
    onDiscard: () => {
      setDiscarded(true)
      setSrc('')
      srcRef.current = ''
      // The failure belonged to the page we just released; the restore raises its own if it fails.
      setFailure(null)
      loadingRef.current = false
      setLoading(false)
      // A background keep-alive GHOST (data.ghost — lib/webviewKeepAlive.ts) whose guest is gone
      // is a husk holding a pool slot: end its entry, which unmounts this whole node. An active
      // node keeps the plate-and-restore behavior unchanged.
      if (data.ghost === true) useWebviewKeepAlive.getState().drop(id)
    },
    onRestore: () => {
      setDiscarded(false)
      // Hold the plate until the source effect has re-run to an outcome. A local file's grant is a
      // round-trip to main, and without this the node flashes "No source" for the whole of it.
      setRestoring(true)
      setError('')
      setFailure(null)
      setRevive((n) => n + 1)
    }
  })

  return (
    <div
      ref={rootRef}
      className={`term-node web-node${selected ? ' selected' : ''}`}
      style={{ borderTopColor: data.color }}
    >
      <NodeResizer minWidth={NODE_MIN_SIZES.web.width} minHeight={NODE_MIN_SIZES.web.height} isVisible={selected} color={data.color} />
      {/* Invisible target handle so a rope from the agent node that opened this can attach. */}
      <Handle
        id="flow-in"
        type="target"
        position={Position.Top}
        isConnectable={false}
        style={{ opacity: 0, pointerEvents: 'none', top: 0 }}
      />

      <div className="term-node__header">
        <span className="term-node__title-text" title={url || filePath}>
          {title}
        </span>
        <span className="term-node__spacer" />
        {live && (
          <Tooltip label="Reload (hold Shift to bypass the cache)">
            <button
              className="term-node__refresh"
              aria-label="Reload"
              onClick={(e) => reloadWebview(wvRef.current, e.shiftKey)}
            >
              <IconReload />
            </button>
          </Tooltip>
        )}
        {url && (
          <Tooltip label="Open in browser">
            <button
              className="term-node__external"
              aria-label="Open in browser"
              onClick={() => {
                const safe = httpUrl(url)
                if (safe) window.nodeTerminal.shell.openExternal(safe)
              }}
            >
              <IconOpenExternal />
            </button>
          </Tooltip>
        )}
        <Tooltip label="Close">
          <button
            className="term-node__close"
            aria-label="Close"
            onClick={() => deleteElements({ nodes: [{ id }] })}
          >
            <IconClose />
          </button>
        </Tooltip>
      </div>

      <div className="editor-node__body">
        <div className="editor-node__image nodrag nowheel">
          {discarded || restoring ? (
            <DiscardedPlate restoring={restoring} />
          ) : live ? (
            <>
              {/* eslint-disable-next-line react/no-unknown-property */}
              <webview
                ref={(el) => {
                  wvRef.current = el as unknown as (AudibleWebview & ReloadableWebview) | null
                }}
                src={src}
                style={{ width: '100%', height: '100%' }}
              />
              {failure && (
                <WebviewErrorPlate failure={failure} onRetry={() => reloadWebview(wvRef.current, false)} />
              )}
              {loading && <WebviewLoadingBar />}
            </>
          ) : (
            <span className="editor-node__loading">{error || 'No source'}</span>
          )}
        </div>
      </div>
    </div>
  )
}
