import { AnyConstructor, isFunction } from 'ytil'

import { AnyFixture, Fixture, FixtureInit, fixtureInstance, FixtureModifiersInput } from './types'

export function fixture<E extends AnyConstructor, Mod extends FixtureModifiersInput<E>>(
  Entity: E,
  init: FixtureInit<Fixture<E, Mod>>,
  modifiers: Mod,
): Fixture<E, Mod>
export function fixture<E extends AnyConstructor>(
  Entity: E,
  init: FixtureInit<Fixture<E, {}>>,
): Fixture<E, {}>
export function fixture<E extends AnyConstructor>(
  Entity: E,
  init: FixtureInit<Fixture<E, any>>,
  modifiers: Record<string, any> = {},
): Fixture<E, any> {
  return {
    [FIXTURE]: true,
    Entity, 
    init, 
    modifiers,
  }
}

export function related<Owner extends AnyFixture, F extends AnyFixture>(
  fixture: F,
  init: (source: fixtureInstance<Owner>) => FixtureInit<F>,
): F {
  return {
    ...fixture,
    init: (ownerInstance?: object) => {
      return {
        ...isFunction(fixture.init) ? fixture.init(ownerInstance) : fixture.init,
        ...init(ownerInstance as fixtureInstance<Owner>),
      }
    },
  }
}

export const FIXTURE = Symbol('FIXTURE')