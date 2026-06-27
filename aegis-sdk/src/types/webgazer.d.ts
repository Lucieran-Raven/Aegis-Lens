declare module 'webgazer' {
  interface WebGazer {
    setGazeListener(callback: (data: any) => void): WebGazer;
    begin(): Promise<void>;
    showVideoPreview(show: boolean): WebGazer;
    showPredictionPoints(show: boolean): WebGazer;
    end(): void;
  }

  const webgazer: WebGazer;
  export default webgazer;
}
