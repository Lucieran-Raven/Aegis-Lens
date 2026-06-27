declare module 'webgazer' {
  export interface GazeData {
    x: number;
    y: number;
  }

  export type GazeListener = (
    data: GazeData | null,
    elapsedTime: number
  ) => void;

  export interface WebGazer {
    setGazeListener(listener: GazeListener): WebGazer;
    begin(): Promise<WebGazer>;
    end(): void;
    showVideoPreview(show: boolean): WebGazer;
    showPredictionPoints(show: boolean): WebGazer;
    setVideoElement(element: HTMLVideoElement): WebGazer;
  }

  const webgazer: WebGazer;
  export default webgazer;
}
