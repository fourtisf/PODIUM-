// A Three.js view of one of the 3D games. Logic lives in @podium/games; this only draws state.
export interface Scene3D<S> {
  /** Draws the current state. Called once per animation frame; must not change the state. */
  render(state: S): void;
  /** Frees GPU resources. The WebGLRenderer itself is owned by the caller and is not disposed here. */
  dispose(): void;
}
