import { IReader } from "../common/observable.js";
export interface IAnimatedValue {
    /**
     * Once true, it can never become false again.
    */
    isFinished(nowMs: number): boolean;
    getValue(nowMs: number): number;
}
export declare class AnimatedValue implements IAnimatedValue {
    readonly startValue: number;
    readonly endValue: number;
    readonly durationMs: number;
    readonly startTimeMs: number;
    private readonly _interpolationFunction;
    static const(value: number): AnimatedValue;
    static startNow(startValue: number, endValue: number, durationMs: number, interpolationFunction?: InterpolationFunction): AnimatedValue;
    constructor(startValue: number, endValue: number, durationMs: number, startTimeMs: number, _interpolationFunction?: InterpolationFunction);
    isFinished(nowMs: number): boolean;
    getValue(nowMs: number): number;
}
export type InterpolationFunction = (passedTime: number, start: number, length: number, totalDuration: number) => number;
export declare function easeOutExpo(passedTime: number, start: number, length: number, totalDuration: number): number;
export declare function easeOutCubic(passedTime: number, start: number, length: number, totalDuration: number): number;
export declare function linear(passedTime: number, start: number, length: number, totalDuration: number): number;
export declare class LoopingAnimatedValue implements IAnimatedValue {
    private readonly _startValue;
    private readonly _endValue;
    private readonly _durationMs;
    private readonly _startTimeMs;
    private readonly _interpolationFunction;
    static startNow(startValue: number, endValue: number, durationMs: number, interpolationFunction: InterpolationFunction): LoopingAnimatedValue;
    constructor(_startValue: number, _endValue: number, _durationMs: number, _startTimeMs: number, _interpolationFunction: InterpolationFunction);
    isFinished(nowMs: number): boolean;
    getValue(nowMs: number): number;
}
export declare class ObservableAnimatedValue<T extends IAnimatedValue = IAnimatedValue> {
    private readonly _value;
    static const(value: number): ObservableAnimatedValue;
    constructor(_value: T);
    getValue(reader: IReader | undefined): number;
    isFinished(reader: IReader | undefined): boolean;
}
export declare class AnimationFrameScheduler {
    static instance: AnimationFrameScheduler;
    private readonly _counter;
    private _isScheduled;
    invalidateOnNextAnimationFrame(reader: IReader | undefined): void;
    private _update;
}
