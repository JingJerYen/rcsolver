declare module "min2phase.js" {
  const min2phase: {
    solve(facelets: string): string;
    randomCube(): string;
    initFull(): void;
  };
  export default min2phase;
}
