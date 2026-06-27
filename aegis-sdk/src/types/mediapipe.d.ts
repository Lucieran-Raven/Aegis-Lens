declare module '@mediapipe/face_mesh' {
  interface FaceMeshOptions {
    locateFile: (file: string) => string;
  }

  interface FaceMesh {
    setOptions(options: any): void;
    onResults(callback: (results: any) => void): void;
    close(): void;
  }

  export class FaceMesh {
    constructor(options: FaceMeshOptions);
  }
}
