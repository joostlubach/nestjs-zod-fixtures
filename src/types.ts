import { EntityManager } from 'typeorm'
import { tz } from 'typeorm-zod'
import { AnyConstructor, AnyFunction, Constructor, Primitive } from 'ytil'
import { FixtureBuilder } from './fixture.builder'

// #region Unbound (input) fixture types

export interface Fixture<E extends AnyConstructor, Init extends () => FixtureInit<E>, Mod extends FixtureModifiersInput<E>> {
  Entity:     E
  init?:      Init
  key?:       (entity: InstanceType<E>) => Primitive
  modifiers?: Mod
}

export type FixtureOf<E extends AnyConstructor> = Fixture<E, () => FixtureInit<E>, FixtureModifiersInput<E>>
export type AnyFixture = Fixture<AnyConstructor, () => FixtureInit<AnyConstructor>, FixtureModifiersInput<AnyConstructor>>

export type FixtureInit<E extends AnyConstructor> = {
  [K in keyof InstanceType<E>]?: FixtureInitValue<InstanceType<E>[K]>
}

type FixtureInitValue<T> =
  // A single value is allowed.
  | T

  // Some function that returns a value is allowed (supports @faker-js and stuff).
  | (() => T)

  // A related fixture (or builder or instance) is allowed.
  | (T extends infer U extends object ? FixtureInput<U> : never)
  | (T extends (infer U extends object) | null ? FixtureInput<U> | null : never)
  | (T extends Array<infer U extends object> ? FixtureInput<U>[] : never)



export type FixtureInput<E extends object> = Fixture<Constructor<E>, any, any> | FixtureBuilder<Fixture<Constructor<E>, any, any>> | E

export type FixtureModifiersInput<E extends AnyConstructor> = Record<string, FixtureModifierInput<E, any[]>>
export type FixtureModifierInput<E extends AnyConstructor, A extends any[]> = (this: FixtureBuildContext, entity: InstanceType<E>, ...args: A) => void

export interface FixtureBuildContext {
  entityManager: EntityManager

  builder: <F extends AnyFixture>(fixture: F, ...args: fixtureInitArgs<F>) => FixtureBuilderOf<F>
  resolve: (value: unknown) => any
  addDependencyBefore: <F extends AnyFixture>(arg: F | object, ...args: fixtureInitArgs<F>) => void
  addDependencyAfter: <F extends AnyFixture>(arg: F | object, ...args: fixtureInitArgs<F>) => void
}

// Dependencies

export enum DependencySaveOrder {
  Before,
  After
}

// Type extractors.
export type fixtureEntity<F extends AnyFixture> = F extends Fixture<infer E, any, any> ? E : never
export type fixtureInstance<F extends AnyFixture> = F extends Fixture<infer E, any, any> ? InstanceType<E> & object : never
export type fixtureInitArgs<F extends AnyFixture> = F extends Fixture<any, (...args: infer A extends any[]) => any, any> ? A : never
export type fixtureModifiers<F extends AnyFixture> = F extends Fixture<any, any, infer M> ? M : never
export type modifierArgs<M extends FixtureModifierInput<any, any>> = M extends FixtureModifierInput<any, infer A> ? A : never

// #endregion

// #region Bound (output) fixture types

export type BoundFixtures<F> = {
  [K in keyof F]: F[K] extends AnyFixture 
    ? BoundFixture<F[K]> 
    : F[K] extends AnyFunction | Symbol | Date | string | boolean | number ? F[K]
      : BoundFixtures<F[K]>
}

export type BoundFixture<F extends AnyFixture> = (...args: fixtureInitArgs<F>) => FixtureBuilderOf<F>
export type FixtureBuilderOf<F extends AnyFixture> = FixtureBuilder<F> & AutoModifiers<F> & FixtureModifiers<F> 

export type FixtureModifiers<F extends AnyFixture> = {
  [K in keyof fixtureModifiers<F>]: FixtureModifier<F, fixtureModifiers<F>[K]>
}
export type FixtureModifier<F extends AnyFixture, I extends FixtureModifierInput<AnyConstructor, any[]>> = (...args: modifierArgs<I>) => FixtureBuilderOf<F>

export type AutoModifiers<F extends AnyFixture> = {
  [K in keyof tz.schemaAttributes<fixtureEntity<F>> as `with_${string & K}`]: (value: FixtureInitValue<tz.schemaAttributes<fixtureEntity<F>>[K]>) => FixtureBuilderOf<F>
}

// #endregion