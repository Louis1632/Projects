import * as rruleModule from 'rrule';

// rrule ships a UMD bundle; Node's ESM loader exposes it only as a default export, while
// bundlers expose named exports. Accept either shape.
type RRuleModule = typeof rruleModule;
const resolved: RRuleModule = (rruleModule as { default?: RRuleModule }).default ?? rruleModule;

export const RRule = resolved.RRule;
export type RRule = InstanceType<RRuleModule['RRule']>;
