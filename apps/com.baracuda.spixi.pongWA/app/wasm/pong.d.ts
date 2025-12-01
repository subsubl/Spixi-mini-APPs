/** Exported memory */
export declare const memory: WebAssembly.Memory;
/** assembly/index/ball */
export declare const ball: {
  /** @type `assembly/index/Ball` */
  get value(): __Record4<never>
};
/** assembly/index/localPaddle */
export declare const localPaddle: {
  /** @type `assembly/index/Paddle` */
  get value(): __Record5<never>
};
/** assembly/index/remotePaddle */
export declare const remotePaddle: {
  /** @type `assembly/index/Paddle` */
  get value(): __Record5<never>
};
/**
 * assembly/index/init
 */
export declare function init(): void;
/**
 * assembly/index/update
 * @param dt `f64`
 */
export declare function update(dt: number): void;
/**
 * assembly/index/setPaddleY
 * @param y `f64`
 */
export declare function setPaddleY(y: number): void;
/**
 * assembly/index/setRemotePaddleY
 * @param y `f64`
 */
export declare function setRemotePaddleY(y: number): void;
/**
 * assembly/index/setBallState
 * @param x `f64`
 * @param y `f64`
 * @param vx `f64`
 * @param vy `f64`
 */
export declare function setBallState(x: number, y: number, vx: number, vy: number): void;
/** assembly/index/Ball */
declare interface __Record4<TOmittable> {
  /** @type `f64` */
  x: number | TOmittable;
  /** @type `f64` */
  y: number | TOmittable;
  /** @type `f64` */
  vx: number | TOmittable;
  /** @type `f64` */
  vy: number | TOmittable;
}
/** assembly/index/Paddle */
declare interface __Record5<TOmittable> {
  /** @type `f64` */
  y: number | TOmittable;
  /** @type `i32` */
  lives: number | TOmittable;
}
