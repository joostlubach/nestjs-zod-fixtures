import { AnyConstructor, isPlainObject } from 'ytil'

import { FIXTURE } from './fixture'
import { Fixture, FixtureModifiersInput } from './types'

export function isFixtureInput<E extends AnyConstructor, Mod extends FixtureModifiersInput<E>>(arg: any): arg is Fixture<E, Mod> {
  if (!isPlainObject(arg)) { return false }
  return arg[FIXTURE] === true
}