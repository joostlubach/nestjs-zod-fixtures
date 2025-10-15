import { AnyConstructor, isPlainObject } from 'ytil'

import { FIXTURE } from './fixture'
import { AnyFixtureOf } from './types'

export function isFixture<E extends AnyConstructor>(arg: any): arg is AnyFixtureOf<E> {
  if (!isPlainObject(arg)) { return false }
  return arg[FIXTURE] === true
}