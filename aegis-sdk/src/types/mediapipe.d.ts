declare module '@mediapipe/face_mesh' {
  export interface FaceMeshOptions {
    maxNumFaces?: number;
    refineLandmarks?: boolean;
    minDetectionConfidence?: number;
    minTrackingConfidence?: number;
  }

  export interface NormalizedLandmark {
    x: number;
    y: number;
    z: number;
  }

  export interface FaceMeshResults {
    multiFaceLandmarks: NormalizedLandmark[][];
    image: HTMLVideoElement | HTMLImageElement;
  }

  export interface FaceMesh {
    setOptions(options: FaceMeshOptions): void;
    onResults(callback: (results: FaceMeshResults) => void): void;
    send(inputs: { image: HTMLVideoElement }): Promise<void>;
    close(): void;
  }

  export interface FaceMeshConstructor {
    new(config: { locateFile: (file: string) => string }): FaceMesh;
  }

  export const FaceMesh: FaceMeshConstructor;
}
