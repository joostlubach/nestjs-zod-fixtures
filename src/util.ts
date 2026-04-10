import { AnyConstructor, isFunction, isPlainObject } from 'ytil'
import { FixtureBuilder } from './fixture.builder'
import { AnyFixture, FixtureOf } from './types'

export function isFixture<E extends AnyConstructor>(arg: any): arg is FixtureOf<E> {
  if (!isPlainObject(arg)) { return false }
  if (!isFunction(arg.Entity)) { return false }
  if (arg.init != null && !isFunction(arg.init)) { return false }
  if (arg.modifiers != null && !isPlainObject(arg.modifiers)) { return false }
  return true
}

export function isFixtureBuilder<F extends AnyFixture>(arg: any): arg is FixtureBuilder<F> {
  if (typeof arg !== 'object' || arg == null) { return false }
  return isFixture(arg.fixture)
}