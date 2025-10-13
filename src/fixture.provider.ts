import { isArray, mapValues } from 'lodash'
import { EntityManager } from 'typeorm'
import { tz } from 'typeorm-zod'
import { deepMapValues, isFunction, MapUtil, objectEntries, objectKeys } from 'ytil'

import {
  AnyFixture,
  BoundFixtures,
  Dependency,
  FixtureInstance,
  fixtureInstance,
  FixtureModifierContext,
} from './types'
import { isFixture } from './util'

export class FixtureProvider {

  constructor(
    private readonly entityManager: EntityManager,
  ) {}

  private readonly dependencies = new Map<AnyFixture, Dependency[]>()
  private readonly instances = new Map<AnyFixture, object>()

  public bind<F extends Record<string, any>>(fixtures: F): BoundFixtures<F> {
    return deepMapValues(fixtures, value => {
      if (isFixture(value)) {
        return () => this.buildFixtureInstance(value)
      }
    }) as BoundFixtures<F>
  }

  public reset() {
    this.dependencies.clear()
    this.instances.clear()
  }

  // #region Building

  private buildFixtureInstance<F extends AnyFixture>(fixture: F, ownerInstance?: object): fixtureInstance<F> {
    const instance = this.buildOrReuseInstance(fixture)
    this.initFixture(fixture, instance, ownerInstance)
    this.fixturize(fixture, instance)
    return instance
  }

  private buildOrReuseInstance<F extends AnyFixture>(fixture: F): fixtureInstance<F> {
    const existing = this.instances.get(fixture) as fixtureInstance<F> | undefined
    if (existing != null) { return existing }

    const repository = this.entityManager.getRepository<fixtureInstance<F>>(fixture.Entity)
    const instance = repository.create()
    tz.applyDefaults(instance)
    this.instances.set(fixture, instance)
    return instance
  }

  private initFixture<F extends AnyFixture>(fixture: F, instance: fixtureInstance<F>, ownerInstance?: object): void {
    if (fixture.init == null) { return }

    const init = isFunction(fixture.init) ? fixture.init(ownerInstance) : fixture.init
    for (const [key, value] of objectEntries(init)) {
      instance[key] = this.resolveProp(fixture, instance, value)
    }
  }

  private resolveProp(fixture: AnyFixture, instance: object, value: any): any {
    if (isFixture(value)) {
      return this.resolveDependency(fixture, instance, value, 'before')
    } else if (isArray(value) && value.every(it => isFixture(it))) {
      return value.map(it => this.resolveDependency(fixture, instance, it, 'after'))
    } else if (isFunction(value)) {
      return value()
    } else {
      return value
    }

  }

  private resolveDependency(ownerFixture: AnyFixture, ownerInstance: object | undefined, value: AnyFixture | (() => object) | object, saveOrder: 'before' | 'after'): object {
    const instance = isFixture(value)
      ? this.buildFixtureInstance(value, ownerInstance)
      : value

    if (isFixture(value)) {
      this.addDependency(ownerFixture, value, instance, saveOrder)
    } else {
      this.addDependency(ownerFixture, instance, saveOrder)
    }
    return instance
  }

  private fixturize<F extends AnyFixture>(fixture: F, instance: fixtureInstance<F>): FixtureInstance<F> {
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
      addDependencyBefore: arg => {
        this.resolveDependency(fixture, instance, arg, 'before')
      },
      addDependencyAfter: arg => {
        this.resolveDependency(fixture, instance, arg, 'after')
      }
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

  private async saveFixtureInstance<F extends AnyFixture>(fixture: F, instance: object) {
    const dependencies = this.dependencies.get(fixture) ?? []
    
    for (const dependency of dependencies.filter(it => it.saveOrder === 'before')) {
      const dependencyInstance = dependency.instance()
      if (dependency.fixture != null) {
        await this.saveFixtureInstance(dependency.fixture, dependencyInstance)
      } else {
        await this.entityManager.save(dependencyInstance)
      }
    }

    const repository = this.entityManager.getRepository(fixture.Entity)
    const saved = await repository.save(instance)
    Object.assign(instance, {...saved})

    for (const dependency of dependencies.filter(it => it.saveOrder === 'after')) {
      const dependencyInstance = dependency.instance()
      if (dependency.fixture != null) {
        await this.saveFixtureInstance(dependency.fixture, dependencyInstance)
      } else {
        await this.entityManager.save(dependencyInstance)
      }
    }

    return instance
  }

  // #endregion

  // #region Dependencies

  private addDependency(owner: AnyFixture, fixture: AnyFixture, instance: object, saveOrder: 'before' | 'after'): void
  private addDependency(owner: AnyFixture, instance: object | (() => object), saveOrder: 'before' | 'after'): void
  private addDependency(owner: AnyFixture, ...args: any[]) {
    const fixture = isFixture(args[0]) ? (args.shift() as AnyFixture) : null
    const instance = args.shift() as object | (() => object)
    const saveOrder = args.shift() as 'before' | 'after'

    const deps = MapUtil.ensure(this.dependencies, owner, () => [])
    deps.push({
      fixture, 
      instance: isFunction(instance) ? instance : () => instance, 
      saveOrder
    })
  }

  // #endregion

}
