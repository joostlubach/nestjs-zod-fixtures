import { camelCase, mapValues, upperFirst } from 'lodash'
import { EntityManager } from 'typeorm'
import { tz } from 'typeorm-zod'
import { deepMapValues, isFunction, MapUtil, objectEntries, objectKeys } from 'ytil'

import { AnyFixture, BoundFixtures, fixtureEntity, FixtureInstance } from './types'
import { isFixtureInput } from './util'

export class FixtureProvider {

  constructor(
    private readonly entityManager: EntityManager,
  ) {}

  private readonly dependencies = new WeakMap<AnyFixture, Set<AnyFixture>>()
  private readonly instances = new WeakMap<AnyFixture, object>()

  public bind<F extends Record<string, any>>(fixtures: F): BoundFixtures<F> {
    return deepMapValues(fixtures, value => {
      if (isFixtureInput(value)) {
        return () => this.buildFixtureInstance(value)
      }
    }) as BoundFixtures<F>
  }

  // #region Building

  private buildFixtureInstance<F extends AnyFixture>(fixture: F, source?: object) {
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
      if (isFixtureInput(value)) {
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

      const setterName = `with${upperFirst(camelCase(key))}`
      Object.defineProperty(instance, setterName, {
        value: function (value: any) {
          this[key] = value
          return this
        },
        enumerable: false,
        writable:   true,
      })
    }

    Object.assign(instance, mapValues(fixture.modifiers, modifier => {
      return (...args: any[]) => {
        const result = modifier(instance, ...args)
        return result ?? instance
      }
    }))

    Object.defineProperty(instance, 'save', {
      value: (includeDependencies = true) => (
        this.saveFixtureInstance(fixture, instance, includeDependencies)
      ),
      enumerable: false,
      writable:   true,
    })

    return instance
  }

  // #endregion

  // #region Saving

  private async saveFixtureInstance<F extends AnyFixture>(fixture: F, instance: FixtureInstance<F>, includeDependencies: boolean) {
    if (includeDependencies) {
      // Don't use Promise.all() here, to prevent a double dependency from being saved twice.
      for (const dependency of this.dependencies.get(fixture) ?? []) {
        const dep_instance = this.buildFixtureInstance(dependency)
        if (dep_instance == null) { continue }
        if ('id' in dep_instance && dep_instance.id != null) { continue }
        
        await this.saveFixtureInstance(dependency, dep_instance, true)
      }
    }

    const repository = this.entityManager.getRepository(fixture.Entity)
    const saved = await repository.save(instance)
    Object.assign(instance, {...saved})

    return instance
  }

  // #endregion

  // #region Dependencies

  private addDependency(from: AnyFixture, to: AnyFixture) {
    const deps = MapUtil.ensure(this.dependencies, from, () => new Set())
    deps.add(to)
  }

  // #endregion

}