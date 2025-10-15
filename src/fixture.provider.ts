import { isArray, mapValues, snakeCase } from 'lodash'
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
  private readonly instances = new Map<string, object>()

  public bind<F extends Record<string, any>>(fixtures: F): BoundFixtures<F> {
    return deepMapValues(fixtures, value => {
      if (isFixture(value)) {
        return (...args: any[]) => this.buildFixtureInstance(value, ...args)
      }
    }) as BoundFixtures<F>
  }

  public reset() {
    this.dependencies.clear()
    this.instances.clear()
  }

  // #region Building

  private buildFixtureInstance<F extends AnyFixture>(fixture: F, ...args: any[]): fixtureInstance<F> {
    const instance = this.buildOrReuseInstance(fixture, args)
    this.initFixture(fixture, instance, args)
    this.fixturize(fixture, instance)
    return instance
  }

  private buildOrReuseInstance<F extends AnyFixture>(fixture: F, args: any[]): fixtureInstance<F> {
    const key = this.fixtureKey(fixture, args)

    const existing = this.instances.get(key) as fixtureInstance<F> | undefined
    if (existing != null) { return existing }

    const repository = this.entityManager.getRepository<fixtureInstance<F>>(fixture.Entity)
    const instance = repository.create()
    tz.applyDefaults(instance)
    this.instances.set(key, instance)
    return instance
  }

  private fixtureKey<F extends AnyFixture>(fixture: F, args: any[]): string {
    return `${fixture.Entity.name}(${JSON.stringify(args)})`
  }

  private initFixture<F extends AnyFixture>(fixture: F, instance: fixtureInstance<F>, args: any[]): void {
    if (fixture.init == null) { return }

    const init = fixture.init(...args)
    for (const [key, value] of objectEntries(init)) {
      instance[key] = this.resolveProp(fixture, instance, value)
    }
  }

  private resolveProp(fixture: AnyFixture, instance: object, value: any): any {
    if (isFixture(value)) {
      // We assume that toOne relationships are not owned.
      return this.resolveDependency(fixture, instance, value, false)
    } else if (isArray(value) && value.every(it => isFixture(it))) {
      // We do assume that toMany relationships are owned.
      return value.map(it => this.resolveDependency(fixture, instance, it, true))
    } else if (isFunction(value)) {
      return value()
    } else {
      return value
    }

  }

  private resolveDependency(ownerFixture: AnyFixture, ownerInstance: object | undefined, value: AnyFixture | (() => object) | object, owned: boolean): object {
    let instance: object
    
    if (isFixture(value)) {
      // Build the instance.
      instance = this.buildFixtureInstance(value)

      // If this is an owned dependency, set the owner instance on the owned instance, either through a custom setter,
      // or by default by inferrring the property name from the owner instance's class name.
      if (ownerInstance !== undefined && owned) {
        if (value.setOwner != null) {
          value.setOwner(instance, ownerInstance)
        } else {
          const ownerProp = snakeCase(ownerInstance.constructor.name)
          Object.assign(instance, {[ownerProp]: ownerInstance})
        }
      }
    } else {
      instance = value
    }


    if (isFixture(value)) {
      this.addDependency(ownerFixture, value, instance, owned ? 'after' : 'before')
    } else {
      this.addDependency(ownerFixture, instance, owned ? 'after' : 'before')
    }
    return instance
  }

  private fixturize<F extends AnyFixture>(fixture: F, instance: fixtureInstance<F>): FixtureInstance<F> {
    for (const key of objectKeys(tz.collectSchema(fixture.Entity).columns)) {
      if (typeof key !== 'string') { continue }

      const setterName = `with_${key}`
      const provider = this

      Object.defineProperty(instance, setterName, {
        value: function (value: any) {
          this[key] = provider.resolveProp(fixture, this, value)
          return this
        },
        enumerable: false,
        writable:   true,
      })
    }

    const context: FixtureModifierContext = {
      entityManager: this.entityManager,
      addOwnerDependency: arg => {
        this.resolveDependency(fixture, instance, arg, false)
      },
      addOwnedDependency: arg => {
        this.resolveDependency(fixture, instance, arg, true)
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
