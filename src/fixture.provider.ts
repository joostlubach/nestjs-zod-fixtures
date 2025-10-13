import { mapValues } from 'lodash'
import { EntityManager } from 'typeorm'
import { tz } from 'typeorm-zod'
import { deepMapValues, isFunction, MapUtil, objectEntries, objectKeys } from 'ytil'

import {
  AnyFixture,
  BoundFixtures,
  fixtureEntity,
  FixtureInstance,
  FixtureModifierContext,
} from './types'
import { isFixture } from './util'

export class FixtureProvider {

  constructor(
    private readonly entityManager: EntityManager,
  ) {}

  private readonly dependencies = new WeakMap<AnyFixture, Set<AnyFixture>>()
  private readonly related = new WeakMap<AnyFixture, Set<object | (() => object)>>()

  private readonly instances = new WeakMap<AnyFixture, object>()

  public bind<F extends Record<string, any>>(fixtures: F): BoundFixtures<F> {
    return deepMapValues(fixtures, value => {
      if (isFixture(value)) {
        return () => this.buildFixtureInstance(value)
      }
    }) as BoundFixtures<F>
  }

  // #region Building

  private buildFixtureInstance<F extends AnyFixture>(fixture: F, source?: object): InstanceType<fixtureEntity<F>> {
    const instance = this.buildOrReuseInstance(fixture)
    this.initFixture(fixture, instance, source)
    this.fixturize(fixture, instance)
    return instance
  }

  private buildOrReuseInstance<F extends AnyFixture>(fixture: F): InstanceType<fixtureEntity<F>> {
    const existing = this.instances.get(fixture) as InstanceType<fixtureEntity<F>> | undefined
    if (existing != null) { return existing }

    const repository = this.entityManager.getRepository<InstanceType<fixtureEntity<F>>>(fixture.Entity)
    const instance = repository.create()
    tz.applyDefaults(instance)
    this.instances.set(fixture, instance)
    return instance
  }

  private initFixture<F extends AnyFixture>(fixture: F, instance: InstanceType<fixtureEntity<F>>, source?: object): void {
    if (fixture.init == null) { return }

    const init = isFunction(fixture.init) ? fixture.init(source) : fixture.init
    for (const [key, value] of objectEntries(init)) {
      if (isFixture(value)) {
        this.addDependency(fixture, value)
        instance[key] = this.buildFixtureInstance(value, instance)
      } else if (isFunction(value)) {
        instance[key] = value()
      } else {
        instance[key] = value
      }
    }
  }

  private fixturize<F extends AnyFixture>(fixture: F, instance: InstanceType<fixtureEntity<F>>): FixtureInstance<F> {
    for (const key of objectKeys(tz.collectSchema(fixture.Entity).columns)) {
      if (typeof key !== 'string') { continue }

      const setterName = `with_${key}`
      Object.defineProperty(instance, setterName, {
        value: function (value: any) {
          this[key] = value
          return this
        },
        enumerable: false,
        writable:   true,
      })
    }

    const context: FixtureModifierContext = {
      entityManager: this.entityManager,
      addDependency: this.addDependency.bind(this, fixture),
      addRelated:    this.addRelated.bind(this, fixture)
    }

    Object.assign(instance, mapValues(fixture.modifiers, modifier => {
      return (...args: any[]) => {
        const result = modifier.call(context, instance, ...args)
        return result ?? instance
      }
    }))

    Object.defineProperty(instance, 'save', {
      value: () => (
        this.saveFixtureInstance(fixture, instance)
      ),
      enumerable: false,
      writable:   true,
    })

    return instance
  }

  // #endregion

  // #region Saving

  private async saveFixtureInstance<F extends AnyFixture>(fixture: F, instance: FixtureInstance<F>) {
    // First, save all dependencies.
    // Note: don't use Promise.all() here, to prevent a double dependency from being saved twice.
    for (const dependency of this.dependencies.get(fixture) ?? []) {
      if (isFixture<any, any>(dependency)) {
        const instance = this.buildFixtureInstance(dependency)
        if (instance == null) { continue }
        if ('id' in instance && instance.id != null) { continue }

        await this.saveFixtureInstance(dependency, instance)
      }
    }

    const repository = this.entityManager.getRepository(fixture.Entity)
    const saved = await repository.save(instance)
    Object.assign(instance, {...saved})

    // After saving, and assigning back the ID, save related objects.
    for (const related of this.related.get(fixture) ?? []) {
      const instance = isFunction(related) ? related() : related
      await this.entityManager.save(instance)
    }

    return instance
  }

  // #endregion

  // #region Dependencies

  private addDependency(fixture: AnyFixture, dependency: AnyFixture) {
    const deps = MapUtil.ensure(this.dependencies, fixture, () => new Set())
    deps.add(dependency)
  }

  private addRelated(from: AnyFixture, related: object | (() => object)) {
    const relateds = MapUtil.ensure(this.related, from, () => new Set())
    relateds.add(related)
  }

  // #endregion

}
