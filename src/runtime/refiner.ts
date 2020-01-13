/**
 * @license
 * Copyright (c) 2019 Google Inc. All rights reserved.
 * This code may only be used under the BSD style license found at
 * http://polymer.github.io/LICENSE.txt
 * Code distributed by Google as part of this project is also
 * subject to an additional IP rights grant found at
 * http://polymer.github.io/PATENTS.txt
 */

import {RefinementNode, RefinementExpressionNode, BinaryExpressionNode, UnaryExpressionNode, FieldNode, NumberNode, BooleanNode} from './manifest-ast-nodes.js';
import {Dictionary} from './hot.js';
import {Schema} from './schema.js';
import {Entity} from './entity.js';

enum Op {
  AND = 'and',
  OR  = 'or',
  LT  = '<',
  GT  = '>',
  LTE = '<=',
  GTE = '>=',
  ADD = '+',
  SUB = '-',
  MUL = '*',
  DIV = '/',
  NOT = 'not',
  NEG = 'neg',
  EQ = '==',
  NEQ = '!=',
}

// Using 'any' because operators are type dependent and generically can only be applied to any.
// tslint:disable-next-line: no-any
type ExpressionPrimitives = any;

export class Refinement {
  kind = 'refinement';
  expression: RefinementExpression = null;

  static fromAst(ref: RefinementNode, typeData: Dictionary<ExpressionPrimitives>): Refinement {
    const refinement = new Refinement();
    refinement.expression = RefinementExpression.fromAst(ref.expression, typeData);
    return refinement;
  }

  static refineData(entity: Entity, schema: Schema): void {
    for (const [name, value] of Object.entries(entity)) {
      const refDict = {[name]: value};
      const ref = schema.fields[name].refinement;
      if (ref && !ref.validateData(refDict)) {
        throw new Error(`Entity schema field '${name}' does not conform to the refinement.`);
      }
    }
    const ref = schema.refinement;
    if (ref && !ref.validateData(entity)) {
      throw new Error('Entity data does not conform to the refinement.');
    }
  }

  // This function assumes the following:
  // ~ The expression is univariate i.e. has exactly one fieldName
  // ~ The expression is valid i.e. no expressions like (num < 3) < (num > 5)
  // This function does the following:
  // ~ Simplifies mathematical and boolean expressions e.g. '(num + (1 + 3) < 4) and True' => '(num + 4) < 4'
  // ~ Converts a binary node to {leftExpr: fieldName, rightExpr: val} (where applicable).
  // ~ Converts a unary node {op: '-', val: x} into a number node {val: -x}
  // ~ Removes redundant info like expression && false => false
  normalise() {
    this.expression = this.expression.normalise();
  }

  toString(): string {
    return '[' + this.expression.toString() + ']';
  }

  validateData(data: Dictionary<ExpressionPrimitives>): boolean {
    const res = this.expression.applyOperator(data);
    if (typeof res !== 'boolean') {
      throw new Error('Refinement expression evaluated to a non-boolean type.');
    }
    return res;
  }
}

abstract class RefinementExpression {
  evalType: 'Boolean' | 'Number' | 'Text';

  static fromAst(expr: RefinementExpressionNode, typeData: Dictionary<ExpressionPrimitives>): RefinementExpression {
    switch (expr.kind) {
      case 'binary-expression-node': return new BinaryExpression(expr, typeData);
      case 'unary-expression-node': return new UnaryExpression(expr, typeData);
      case 'field-name-node': return new FieldNamePrimitive(expr, typeData);
      case 'number-node': return new NumberPrimitive(expr);
      case 'boolean-node': return new BooleanPrimitive(expr);
      default:
        // Should never happen; all known kinds are handled above, but the linter wants a default.
        throw new Error('Unknown node type.');
    }
  }

  normalise(): RefinementExpression {
    return this;
  }

  abstract toString(): string;

  abstract applyOperator(data: Dictionary<ExpressionPrimitives>);
}

export class BinaryExpression extends RefinementExpression {
  evalType: 'Number' | 'Boolean';
  leftExpr: RefinementExpression;
  rightExpr: RefinementExpression;
  operator: RefinementOperator;

  constructor(expression: BinaryExpressionNode, typeData: Dictionary<ExpressionPrimitives>) {
    super();
    this.leftExpr = RefinementExpression.fromAst(expression.leftExpr, typeData);
    this.rightExpr = RefinementExpression.fromAst(expression.rightExpr, typeData);
    this.operator = new RefinementOperator(expression.operator);
    this.operator.validateOperandCompatibility([this.leftExpr.evalType, this.rightExpr.evalType]);
    this.evalType = this.operator.evalType();
  }

  toString(): string {
    return `(${this.leftExpr.toString()} ${this.operator.op} ${this.rightExpr.toString()})`;
  }

  applyOperator(data: Dictionary<ExpressionPrimitives>): ExpressionPrimitives {
    const left = this.leftExpr.applyOperator(data);
    const right = this.rightExpr.applyOperator(data);
    return this.operator.eval([left, right]);
  }

  swapChildren() {
    const temp = this.rightExpr;
    this.rightExpr = this.leftExpr;
    this.leftExpr = temp;
    switch (this.operator.op) {
      case Op.LT: this.operator.updateOp(Op.GT); break;
      case Op.GT: this.operator.updateOp(Op.LT); break;
      case Op.LTE: this.operator.updateOp(Op.GTE); break;
      case Op.GTE: this.operator.updateOp(Op.LTE); break;
      default: break;
    }
  }

  simplifyPrimitive() {
    if (this.leftExpr instanceof BooleanPrimitive && this.rightExpr instanceof BooleanPrimitive) {
      return BooleanPrimitive.fromValue(this.applyOperator({}));
    } else if (this.leftExpr instanceof NumberPrimitive && this.rightExpr instanceof NumberPrimitive) {
      if (this.evalType === 'Boolean') {
        return BooleanPrimitive.fromValue(this.applyOperator({}));
      }
      return NumberPrimitive.fromValue(this.applyOperator({}));
    }
    return null;
  }

  normalise() {
    this.leftExpr = this.leftExpr.normalise();
    this.rightExpr = this.rightExpr.normalise();
    const sp = this.simplifyPrimitive();
    if (sp) {
      return sp;
    }
    if (this.rightExpr instanceof FieldNamePrimitive) {
      this.swapChildren();
    }
    switch (this.operator.op) {
      case Op.AND: {
        if (this.leftExpr instanceof BooleanPrimitive) {
          return this.leftExpr.value ? this.rightExpr : this.leftExpr;
        } else if (this.rightExpr instanceof BooleanPrimitive) {
          return this.rightExpr.value ? this.leftExpr : this.rightExpr;
        }
        return this;
      }
      case Op.OR: {
        if (this.leftExpr instanceof BooleanPrimitive) {
          return this.leftExpr.value ? this.leftExpr : this.rightExpr;
        } else if (this.rightExpr instanceof BooleanPrimitive) {
          return this.rightExpr.value ? this.rightExpr : this.leftExpr;
        }
        return this;
      }
      default: return this;
    }
  }
}

export class UnaryExpression extends RefinementExpression {
  evalType: 'Number' | 'Boolean';
  expr: RefinementExpression;
  operator: RefinementOperator;

  constructor(expression: UnaryExpressionNode, typeData: Dictionary<ExpressionPrimitives>) {
    super();
    this.expr = RefinementExpression.fromAst(expression.expr, typeData);
    this.operator = new RefinementOperator((expression.operator === Op.SUB) ? Op.NEG : expression.operator);
    this.operator.validateOperandCompatibility([this.expr.evalType]);
    this.evalType = this.operator.evalType();
  }

  toString(): string {
    return this.operator.op + '(' + this.expr.toString() + ')';
  }

  applyOperator(data: Dictionary<ExpressionPrimitives>): ExpressionPrimitives {
    const expression = this.expr.applyOperator(data);
    return this.operator.eval([expression]);
  }

  simplifyPrimitive() {
    if (this.expr instanceof BooleanPrimitive && this.operator.op === Op.NOT) {
      return BooleanPrimitive.fromValue(this.applyOperator({}));
    } else if (this.expr instanceof NumberPrimitive && this.operator.op === Op.NEG) {
      return NumberPrimitive.fromValue(this.applyOperator({}));
    }
    return null;
  }

  normalise(): RefinementExpression {
    this.expr = this.expr.normalise();
    const sp = this.simplifyPrimitive();
    if (sp) {
      return sp;
    }
    switch (this.operator.op) {
      case Op.NOT: {
        if (this.expr instanceof UnaryExpression && this.expr.operator.op === Op.NOT) {
          return this.expr.expr;
        }
        return this;
      }
      default:
        return this;
    }
  }
}

class FieldNamePrimitive extends RefinementExpression {
  evalType: 'Number' | 'Boolean' | 'Text';
  value: string;

  constructor(expression: FieldNode, typeData: Dictionary<ExpressionPrimitives>) {
    super();
    this.value = expression.value;
    if (typeData[this.value] == undefined) {
      throw new Error(`Unresolved field name '${this.value}' in the refinement expression.`);
    }
    this.evalType = typeData[this.value];
  }

  static fromValue(value: string, evalType: 'Number' | 'Boolean' | 'Text'): RefinementExpression {
    return new FieldNamePrimitive({value} as FieldNode, {[value]: evalType});
  }

  toString(): string {
    return this.value.toString();
  }

  applyOperator(data: Dictionary<ExpressionPrimitives>): ExpressionPrimitives {
    if (data[this.value] != undefined) {
      return data[this.value];
    }
    throw new Error(`Unresolved field name '${this.value}' in the refinement expression.`);
  }
}

class NumberPrimitive extends RefinementExpression {
  evalType: 'Number';
  value: number;

  constructor(expression: NumberNode) {
    super();
    this.value = expression.value;
    this.evalType = 'Number';
    return this;
  }

  static fromValue(value: number): RefinementExpression {
    return new NumberPrimitive({value} as NumberNode);
  }

  toString(): string {
    return this.value.toString();
  }

  applyOperator(): ExpressionPrimitives {
    return this.value;
  }
}

class BooleanPrimitive extends RefinementExpression {
  evalType: 'Boolean';
  value: boolean;

  constructor(expression: BooleanNode) {
    super();
    this.value = expression.value;
    this.evalType = 'Boolean';
  }

  static fromValue(value: boolean): RefinementExpression {
    return new BooleanPrimitive({value} as BooleanNode);
  }

  toString(): string {
    return this.value.toString();
  }

  applyOperator(): ExpressionPrimitives {
    return this.value;
  }
}

export class Range {
  private _segments: Segment[] = [];

  constructor(segs: Segment[] = []) {
    for (const seg of segs) {
      this.unionWithSeg(seg);
    }
  }

  get segments() {
    return this._segments;
  }

  static validateSegments(segs: Segment[]): void {
    for (let i = 1; i < segs.length; i++) {
      if (!segs[i].isGreaterThan(segs[i-1], true)) {
        throw new Error(`Invalid segments: ${JSON.stringify(segs[i-1])} must be strictly less than ${JSON.stringify(segs[i])}`);
      }
    }
  }

  static infiniteRange(): Range {
    return new Range([Segment.openOpen(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY)]);
  }

  static copyOf(range: Range): Range {
    return new Range(range.segments);
  }

  // This function assumes that the expression is univariate
  // and has been normalised (see above for definition).
  // TODO(ragdev): Currently only Number types are supported. Add Boolean and String support.
  static fromExpression(expr: RefinementExpression): Range {
    if (expr instanceof BinaryExpression) {
      if (expr.leftExpr instanceof FieldNamePrimitive && expr.rightExpr instanceof NumberPrimitive) {
        return Range.makeInitialGivenOp(expr.operator.op, expr.rightExpr.value);
      }
      const left = Range.fromExpression(expr.leftExpr);
      const right = Range.fromExpression(expr.rightExpr);
      return Range.updateGivenOp(expr.operator.op, [left, right]);
    } else if (expr instanceof UnaryExpression) {
      const rg = Range.fromExpression(expr.expr);
      return Range.updateGivenOp(expr.operator.op, [rg]);
    }
    throw new Error(`Cannot resolve primitive nodes by themselves: ${expr.toString()}`);
  }

  static unionOf(range1: Range, range2: Range): Range {
    const newRange = Range.copyOf(range1);
    newRange.union(range2);
    return newRange;
  }

  static intersectionOf(range1: Range, range2: Range): Range {
    const newRange = Range.copyOf(range1);
    newRange.intersect(range2);
    return newRange;
  }

  static complementOf(range: Range, from: Range = Range.infiniteRange()) {
    return Range.difference(from, range);
  }

  // difference(A,B) = A\B = A - B
  static difference(range1: Range, range2: Range): Range {
    const newRange = new Range();
    for (const seg of range1.segments) {
      const ntrsct = Range.copyOf(range2);
      ntrsct.intersectWithSeg(seg);
      let from: Boundary = {...seg.from};
      for (const iseg of ntrsct.segments) {
        const to: Boundary = {...iseg.from};
        to.kind = to.kind === 'open' ? 'closed' : 'open';
        if (Segment.isValid(from, to)) {
          newRange.segments.push(new Segment(from, to));
        }
        from = iseg.to;
        from.kind = from.kind === 'open' ? 'closed' : 'open';
      }
      const to: Boundary = {...seg.to};
      if (Segment.isValid(from, to)) {
        newRange.segments.push(new Segment(from, to));
      }
    }
    return newRange;
  }

  equals(range: Range): boolean {
    if (this.segments.length !== range.segments.length) {
      return false;
    }
    for (let i = 0; i < this.segments.length; i++) {
      if (!this.segments[i].equals(range.segments[i])) {
        return false;
      }
    }
    return true;
  }

  isSubsetOf(range: Range): boolean {
    return this.equals(Range.intersectionOf(this, range));
  }

  union(range: Range): void {
    for (const seg of range.segments) {
      this.unionWithSeg(seg);
    }
  }

  intersect(range: Range): void {
    const newRange = new Range();
    for (const seg of range.segments) {
      const dup = Range.copyOf(this);
      dup.intersectWithSeg(seg);
      newRange.union(dup);
    }
    this._segments = newRange.segments;
  }

  unionWithSeg(seg: Segment): void {
    let i = 0;
    let j = this.segments.length;
    let x: Boundary = {...seg.from};
    let y: Boundary = {...seg.to};
    for (const subRange of this.segments) {
      if (seg.isGreaterThan(subRange, false)) {
        i += 1;
      } else {
        if (seg.mergeableWith(subRange)) {
          const m = Segment.merge(seg, subRange);
          x = {...m.from};
        } else {
          x = subRange.from.val < x.val ? {...subRange.from} : x;
        }
        break;
      }
    }
    for (const subRange of this.segments.slice().reverse()) {
      if (seg.isLessThan(subRange, false)) {
        j -= 1;
      } else {
        if (seg.mergeableWith(subRange)) {
          const m = Segment.merge(seg, subRange);
          y = {...m.to};
        } else {
          y = subRange.to.val > y.val ? {...subRange.to} : y;
        }
        break;
      }
    }
    this.segments.splice(i, j-i, new Segment(x, y));
  }

  intersectWithSeg(seg: Segment): void {
    const newRange = new Range();
    for (const subRange of this.segments) {
      if (subRange.overlapsWith(seg)) {
        newRange.segments.push(Segment.overlap(seg, subRange));
      }
    }
    this._segments = newRange.segments;
  }

  static makeInitialGivenOp(op: string, val: ExpressionPrimitives): Range {
    switch (op) {
      case Op.LT: return new Range([Segment.openOpen(Number.NEGATIVE_INFINITY, val)]);
      case Op.LTE: return new Range([Segment.openClosed(Number.NEGATIVE_INFINITY, val)]);
      case Op.GT: return new Range([Segment.openOpen(val, Number.POSITIVE_INFINITY)]);
      case Op.GTE: return new Range([Segment.closedOpen(val, Number.POSITIVE_INFINITY)]);
      case Op.EQ: return new Range([Segment.closedClosed(val, val)]);
      case Op.NEQ: return Range.complementOf(new Range([Segment.closedClosed(val, val)]));
      default: throw new Error(`Unsupported operator: field ${op} number`);
    }
  }

  static updateGivenOp(op: string, ranges: Range[]): Range {
    switch (op) {
      case Op.AND: {
        return Range.intersectionOf(ranges[0], ranges[1]);
      }
      case Op.OR: {
        return Range.unionOf(ranges[0], ranges[1]);
      }
      case Op.EQ: {
        const lc = Range.complementOf(ranges[0]);
        const rc = Range.complementOf(ranges[1]);
        const lnr = Range.intersectionOf(ranges[0], ranges[1]);
        const lcnrc = Range.intersectionOf(lc, rc);
        return Range.unionOf(lnr, lcnrc);
      }
      case Op.NEQ: {
        const lc = Range.complementOf(ranges[0]);
        const rc = Range.complementOf(ranges[1]);
        const lnrc = Range.intersectionOf(ranges[0], rc);
        const lcnr = Range.intersectionOf(lc, ranges[1]);
        return Range.unionOf(lnrc, lcnr);
      }
      case Op.NOT: {
        return Range.complementOf(ranges[0]);
      }
      default:
        throw new Error(`Unsupported operator: cannot update range`);
    }
  }
}

export class Segment {
  from: Boundary;
  to: Boundary;

  constructor(from: Boundary, to: Boundary) {
    if (!Segment.isValid(from, to)) {
      throw new Error(`Invalid range from: ${from}, to:${to}`);
    }
    this.from = {...from};
    this.to = {...to};
  }

  static isValid(from: Boundary, to: Boundary): boolean {
    if (to.val < from.val) {
      return false;
    } else if (from.val === to.val && (from.kind === 'open' || to.kind === 'open')) {
      return false;
    }
    return true;
  }

  static closedClosed(from: number, to: number): Segment {
    return new Segment({val: from, kind: 'closed'}, {val: to, kind: 'closed'});
  }

  static openOpen(from: number, to: number): Segment {
    return new Segment({val: from, kind: 'open'}, {val: to, kind: 'open'});
  }

  static closedOpen(from: number, to: number): Segment {
    return new Segment({val: from, kind: 'closed'}, {val: to, kind: 'open'});
  }

  static openClosed(from: number, to: number): Segment {
    return new Segment({val: from, kind: 'open'}, {val: to, kind: 'closed'});
  }

  equals(seg: Segment): boolean {
    return this.from.kind === seg.from.kind &&
      this.from.val === seg.from.val &&
      this.to.kind === seg.to.kind &&
      this.to.val === seg.to.val;
  }

  // If strict is false, (a,x) is NOT less than [x,b)
  // even though mathematically it is.
  isLessThan(seg: Segment, strict: boolean): boolean {
    if (this.to.val === seg.from.val) {
      if (strict) {
        return this.to.kind === 'open' || seg.from.kind === 'open';
      }
      return this.to.kind === 'open' && seg.from.kind === 'open';
    }
    return this.to.val < seg.from.val;
  }

  // If strict is false, (x,a) is NOT greater than (b,x]
  // even though mathematically it is.
  isGreaterThan(seg: Segment, strict: boolean): boolean {
    if (this.from.val === seg.to.val) {
      if (strict) {
        return this.from.kind === 'open' || seg.to.kind === 'open';
      }
      return this.from.kind === 'open' && seg.to.kind === 'open';
    }
    return this.from.val > seg.to.val;
  }

  mergeableWith(seg: Segment): boolean {
    return !this.isLessThan(seg, false) && !this.isGreaterThan(seg, false);
  }

  overlapsWith(seg: Segment): boolean {
    return !this.isLessThan(seg, true) && !this.isGreaterThan(seg, true);
  }

  static merge(a: Segment, b: Segment): Segment {
    if (!a.mergeableWith(b)) {
      throw new Error('Cannot merge non-overlapping segments');
    }
    let left: Boundary;
    let right: Boundary;
    if (a.from.val === b.from.val) {
      left = {...a.from};
      left.kind = a.from.kind === b.from.kind ? a.from.kind : 'closed';
    } else {
      left = a.from.val < b.from.val ? {...a.from} : {...b.from};
    }
    if (a.to.val === b.to.val) {
      right = {...a.to};
      right.kind = a.to.kind === b.to.kind ? a.to.kind : 'closed';
    } else {
      right = a.to.val > b.to.val ? {...a.to} : {...b.to};
    }
    return new Segment(left, right);
  }

  static overlap(a: Segment, b: Segment): Segment {
    if (!a.overlapsWith(b)) {
      throw new Error('Cannot find intersection of non-overlapping segments');
    }
    let left: Boundary;
    let right: Boundary;
    if (a.from.val === b.from.val) {
      left = {...a.from};
      left.kind = a.from.kind === b.from.kind ? a.from.kind : 'open';
    } else {
      left = a.from.val > b.from.val ? {...a.from} : {...b.from};
    }
    if (a.to.val === b.to.val) {
      right = {...a.to};
      right.kind = a.to.kind === b.to.kind ? a.to.kind : 'open';
    } else {
      right = a.to.val < b.to.val ? {...a.to} : {...b.to};
    }
    return new Segment(left, right);
  }
}

interface Boundary {
  val: number;
  kind: 'open' | 'closed';
}

interface OperatorInfo {
  nArgs: number;
  argType: string;
  evalType: 'Boolean' | 'Number';
  evalFn: (exprs: ExpressionPrimitives[]) => ExpressionPrimitives;
}

const operatorTable: Dictionary<OperatorInfo> = {
  [Op.AND]: {nArgs: 2, argType: 'Boolean', evalType: 'Boolean', evalFn: e => e[0] && e[1]},
  [Op.OR]: {nArgs: 2, argType: 'Boolean', evalType: 'Boolean', evalFn: e => e[0] || e[1]},
  [Op.LT]: {nArgs: 2, argType: 'Number',  evalType: 'Boolean', evalFn: e => e[0] < e[1]},
  [Op.GT]: {nArgs: 2, argType: 'Number',  evalType: 'Boolean', evalFn: e => e[0] > e[1]},
  [Op.LTE]: {nArgs: 2, argType: 'Number',  evalType: 'Boolean', evalFn: e => e[0] <= e[1]},
  [Op.GTE]: {nArgs: 2, argType: 'Number',  evalType: 'Boolean', evalFn: e => e[0] >= e[1]},
  [Op.ADD]: {nArgs: 2, argType: 'Number',  evalType: 'Number', evalFn: e => e[0] + e[1]},
  [Op.SUB]: {nArgs: 2, argType: 'Number',  evalType: 'Number', evalFn: e => e[0] - e[1]},
  [Op.MUL]: {nArgs: 2, argType: 'Number',  evalType: 'Number', evalFn: e => e[0] * e[1]},
  [Op.DIV]: {nArgs: 2, argType: 'Number',  evalType: 'Number', evalFn: e => e[0] / e[1]},
  [Op.NOT]: {nArgs: 1, argType: 'Boolean',  evalType: 'Boolean', evalFn: e => !e[0]},
  [Op.NEG]: {nArgs: 1, argType: 'Number',  evalType: 'Number', evalFn: e => -e[0]},
  [Op.EQ]: {nArgs: 2, argType: 'same', evalType: 'Boolean', evalFn: e => e[0] === e[1]},
  [Op.NEQ]: {nArgs: 2, argType: 'same', evalType: 'Boolean', evalFn: e => e[0] !== e[1]},
};

class RefinementOperator {
  opInfo: OperatorInfo;
  op: string;

  constructor(operator: string) {
    this.op = operator;
    this.updateOp(operator);
  }

  updateOp(operator: string) {
    this.op = operator;
    this.opInfo = operatorTable[operator];
    if (!this.opInfo) {
      throw new Error(`Invalid refinement operator ${operator}`);
    }
  }

  eval(exprs: ExpressionPrimitives[]): ExpressionPrimitives {
    return this.opInfo.evalFn(exprs);
  }

  evalType(): 'Number' | 'Boolean' {
    return this.opInfo.evalType;
  }

  validateOperandCompatibility(operandTypes: string[]): void {
    if (operandTypes.length !== this.opInfo.nArgs) {
      throw new Error(`Expected ${this.opInfo.nArgs} operands. Got ${operandTypes.length}.`);
    }
    if (this.opInfo.argType === 'same') {
      if (operandTypes[0] !== operandTypes[1]) {
        throw new Error(`Expected ${operandTypes[0]} and ${operandTypes[1]} to be the same.`);
      }
    } else {
      for (const type of operandTypes) {
        if (type !== this.opInfo.argType) {
          throw new Error(`Got type ${type}. Expected ${this.opInfo.argType}.`);
        }
      }
    }
  }
}