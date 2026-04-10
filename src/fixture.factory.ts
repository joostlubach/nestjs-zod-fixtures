import { AnyConstructor, Primitive } from 'ytil'
import { Fixture, FixtureInit, FixtureModifiersInput } from './types'

export function fixture<E extends AnyConstructor, Init extends () => FixtureInit<E>, Mod extends FixtureModifiersInput<E>>(
  Entity: E,
  init: Init,
  options: FixtureOptions<E> & {modifiers: Mod}
): Fixture<E, Init, Mod>
export function fixture<E extends AnyConstructor, Init extends () => FixtureInit<E>>(
  Entity: E,
  init: Init,
  options: FixtureOptions<E>
): Fixture<E, Init, Record<never, never>>
export function fixture<E extends AnyConstructor, Init extends () => FixtureInit<E>>(
  Entity: E,
  init: Init,
): Fixture<E, Init, Record<never, never>>
export function fixture<E extends AnyConstructor, Init extends () => FixtureInit<E>>(
  Entity: E,
  init: Init,
  options: FixtureOptions<E> = {},
): Fixture<E, Init, FixtureModifiersInput<E>> {
  return {
    Entity, 
    init, 
    modifiers: {},
    ...options,
  }
}

export interface FixtureOptions<E extends AnyConstructor> {
  modifiers?: FixtureModifiersInput<E>
  key?: (entity: InstanceType<E>) => Primitive
}