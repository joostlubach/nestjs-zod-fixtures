import { AnyConstructor, isFunction } from 'ytil'

import { AnyFixture, Fixture, fixtureEntity, FixtureInit, FixtureModifiersInput } from './types'

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

export function related<S extends AnyFixture, F extends AnyFixture>(
  fixture: F,
  init: (source: InstanceType<fixtureEntity<S>>) => FixtureInit<F>,
): F {
  // Create a new fixture that inits the 

  return {
    ...fixture,
    init: (source?: object) => {
      return {
        ...isFunction(fixture.init) ? fixture.init(source) : fixture.init,
        ...init(source as InstanceType<fixtureEntity<S>>),
      }
    },
  }
}

export const FIXTURE = Symbol('FIXTURE')