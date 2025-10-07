import { tz } from 'typeorm-zod'
import { AnyConstructor, AnyFunction } from 'ytil'

import { FIXTURE } from './fixture'

// #region Unbound (input) fixture types

export interface Fixture<E extends AnyConstructor, Mod extends FixtureModifiersInput<E>> {
  [FIXTURE]: true

  Entity:    E
  init?:     FixtureInit<Fixture<E, Mod>> | ((source?: object) => Fixture<E, Mod>)
  modifiers: Mod
}

export type AnyFixture = Fixture<any, any>

export type FixtureInit<S extends AnyFixture> = {
  [K in keyof InstanceType<fixtureEntity<S>>]?:
    // A single value is allowed.
    | InstanceType<fixtureEntity<S>>[K]
    // Some function that returns a value is allowed (supports @faker-js and stuff).
    | (() => InstanceType<fixtureEntity<S>>[K])
    // A related fixture is allowed.
    | AnyFixture
    // For ToMany relationships, we accept an array of related fixtures.
    | AnyFixture[]
}

export type FixtureModifiersInput<E extends AnyConstructor> = Record<string, FixtureModifierInput<E, any>>
export type FixtureModifierInput<E extends AnyConstructor, A extends any[]> = (entity: InstanceType<E>, ...args: A) => E | void

export type FixtureWith<S extends AnyFixture> = (instance: InstanceType<fixtureEntity<S>>) => AnyFixture

// Type extractors.
export type fixtureEntity<F extends AnyFixture> = F extends Fixture<infer E, infer M> ? E : never
export type fixtureModifiers<F extends AnyFixture> = F extends Fixture<any, infer M> ? M : never
export type modifierArgs<M extends FixtureModifierInput<any, any>> = M extends FixtureModifierInput<any, infer A> ? A : never

// #endregion

// #region Bound (output) fixture types

export type BoundFixtures<F> = {
  [K in keyof F]: F[K] extends AnyFixture 
    ? BoundFixture<F[K]> 
    : F[K] extends AnyFunction | Symbol | Date | string | boolean | number ? F[K]
      : BoundFixtures<F[K]>
}

export type BoundFixture<F extends AnyFixture> = () => FixtureInstance<F>
export type FixtureInstance<F extends AnyFixture> = InstanceType<fixtureEntity<F>> & AutoModifiers<F> & FixtureModifiers<F> & FixtureCommon<F>

export type FixtureModifiers<F extends AnyFixture> = {
  [K in keyof fixtureModifiers<F>]: FixtureModifier<F, fixtureModifiers<F>[K]>
}
export type FixtureModifier<F extends AnyFixture, I extends FixtureModifierInput<any, any[]>> = (...args: modifierArgs<I>) => FixtureInstance<F>
export type AutoModifiers<F extends AnyFixture> = {
  [K in keyof tz.schemaAttributes<fixtureEntity<F>> as `with_${string & K}`]: (value: tz.schemaAttributes<fixtureEntity<F>>[K]) => FixtureInstance<F>
}

export interface FixtureCommon<F extends AnyFixture> {
  save(includeDependencies?: boolean): Promise<FixtureInstance<F>>
}

// #endregion