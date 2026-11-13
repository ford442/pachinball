/**
 * The slice of AudioWorkletGlobalScope the voice processor uses. The DOM lib has
 * `AudioWorkletNode` but not these, and the worklet project (tsconfig.worklet.json) must not
 * pull the DOM lib in. Kept local instead of @types/audioworklet so the app project never sees them.
 */
declare const sampleRate: number
declare const currentTime: number

interface AudioWorkletMessagePort {
  onmessage: ((event: MessageEvent) => void) | null
  postMessage(message: unknown): void
}

interface MessageEvent<T = unknown> {
  readonly data: T
}

declare class AudioWorkletProcessor {
  readonly port: AudioWorkletMessagePort
  constructor()
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean
}

declare function registerProcessor(name: string, processorCtor: new () => AudioWorkletProcessor): void
