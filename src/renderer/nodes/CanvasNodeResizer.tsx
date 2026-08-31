import { NodeResizer, type NodeResizerProps } from '@xyflow/react'
import { useResizeLocked } from '../state/canvasLock'

/**
 * `NodeResizer` with the canvas lock applied. Every node kind renders its own resizer and React
 * Flow gives them no prop path from the canvas, so the aspect is read here — once, in the one
 * place that states the rule — instead of in nine components that would drift apart.
 *
 * Hiding the handles is the whole mechanism: React Flow resizes from the handles, so no handles
 * means no resize, while the node stays selectable, draggable and interactive.
 */
export function CanvasNodeResizer({ isVisible, ...rest }: NodeResizerProps) {
  const locked = useResizeLocked()
  return <NodeResizer {...rest} isVisible={isVisible && !locked} />
}
