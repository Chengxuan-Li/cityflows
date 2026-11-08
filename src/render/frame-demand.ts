declare global {
  interface Window {
    cityflowsRenderContinuously?: boolean;
  }
}

/** Setters coalesce changes until the next animation frame consumes them. */
export class FrameDemand {
  pending = true;

  invalidate = () => {
    this.pending = true;
  };

  consume(continuous = false): boolean {
    const draw = this.pending || continuous;
    this.pending = false;
    return draw;
  }
}

export const renderContinuously = () =>
  import.meta.env.MODE === 'test' && window.cityflowsRenderContinuously === true;
