import { snakeCase } from 'lodash'
import { AnyConstructor } from 'ytil'

import { AnyFixture, Fixture, FixtureInit, fixtureInstance, FixtureModifiersInput } from './types'

export function fixture<E extends AnyConstructor, Init extends () => FixtureInit<E>, Mod extends FixtureModifiersInput<E>>(
  Entity: E,
  init: Init,
  modifiers: Mod,
): Fixture<E, Init, Mod>
export function fixture<E extends AnyConstructor, Init extends () => FixtureInit<E>>(
  Entity: E,
  init: Init,
): Fixture<E, Init, {}>
export function fixture<E extends AnyConstructor, Init extends () => FixtureInit<E>>(
  Entity: E,
  init: Init,
  modifiers: Record<string, any> = {},
): Fixture<E, Init, any> {
  return {
    [FIXTURE]: true,
    Entity, 
    init, 
    modifiers,
  }
}

export function related<Owner extends AnyFixture, F extends AnyFixture>(
  fixture: F,
  setOwner: (instance: fixtureInstance<F>, ownerInstance: fixtureInstance<Owner>) => void,
): F {
  return {
    ...fixture,
    setOwner: setOwner ?? ((instance, ownerInstance) => {
      const inferredOwnerKey = snakeCase(ownerInstance.constructor.name)
      instance[inferredOwnerKey] = ownerInstance
    })
  }
}

export const FIXTURE = Symbol('FIXTURE')