import { isArray } from 'lodash'
import { EntityManager } from 'typeorm'
import { tz } from 'typeorm-zod'
import { AnyConstructor, deepMapValues, isFunction, MapUtil, Primitive } from 'ytil'
import { Dependency } from './dependency'
import { FixtureBuilder } from './fixture.builder'
import {
  AnyFixture,
  BoundFixtures,
  DependencySaveOrder,
  FixtureBuildContext,
  fixtureInitArgs,
  fixtureInstance,
} from './types'
import { isFixture, isFixtureBuilder } from './util'

export class FixtureProvider {

  constructor(
    public readonly entityManager: EntityManager,
  ) {}

  private readonly dependencies = new Map<FixtureBuilder<AnyFixture>, Dependency<AnyFixture>[]>()
  private readonly instances = new Map<AnyConstructor, Map<Primitive, object>>()

  public bind<FR extends Record<string, any>>(recipes: FR): BoundFixtures<FR> {
    const createFixtureBuilderFactory = <F extends AnyFixture>(fixture: F) => {
      return (...args: fixtureInitArgs<F>) => {
        return FixtureBuilder.for(fixture, this, args)
      }
    }

    return deepMapValues(recipes, value => {
      if (isFixture(value)) {
        return createFixtureBuilderFactory(value)
      }
    }) as BoundFixtures<FR>
  }

  public reset() {
    this.dependencies.clear()
    this.instances.clear()
  }

  // #region Instances

  public getInstance<F extends AnyFixture>(builder: FixtureBuilder<F>): fixtureInstance<F> {
    const instance = this.buildInstance(builder)
    const key = builder.key(instance)
    if (key === undefined) {
      // If no key option is specified, we assume that all instances of this fixture are different.
      return instance
    }

    // Try to see if there was an existing instance. If so, discard the built one and reuse the existing one.
    const instancesForEntity = this.instances.get(builder.fixture.Entity) ?? new Map()
    const existing = instancesForEntity?.get(key) as fixtureInstance<F> | undefined

    if (existing != null) {
      // Reapply the modifiers to the existing instance, in case the modifiers augment stuff that is not part
      // of the key.
      const context = this.buildModifierContext(builder)
      builder.applyModifiers(existing, context, false)

      return existing
    }

    instancesForEntity.set(key, instance)
    this.instances.set(builder.fixture.Entity, instancesForEntity)
    return instance
  }

  private buildInstance<F extends AnyFixture>(builder: FixtureBuilder<F>): fixtureInstance<F> {
    const context = this.buildModifierContext(builder)
    const repository = context.entityManager.getRepository<fixtureInstance<F>>(builder.fixture.Entity)
    
    const instance = repository.create()
    tz.applyDefaults(instance)

    builder.applyModifiers(instance, context, true)
  
    return instance
  }

  // #endregion

  private buildModifierContext<F extends AnyFixture>(builder: FixtureBuilder<F>): FixtureBuildContext {
    return {
      entityManager: this.entityManager,
      builder: (fixture, ...args) => {
        return FixtureBuilder.for(fixture, this, args)
      },
      resolve: (value: unknown) => {
        return this.resolveProp(builder, value)
      },
      addDependencyBefore: (arg, ...args) => {
        this.resolveDependency(builder, arg, args, DependencySaveOrder.Before)
      },
      addDependencyAfter: (arg, ...args) => {
        this.resolveDependency(builder, arg, args, DependencySaveOrder.After)
      }
    }
  }

  private resolveProp<F extends AnyFixture>(builder: FixtureBuilder<F>, value: unknown): any {
    if (isFixture(value) || isFixtureBuilder(value)) {
      // We assume that toOne relationships are not owned.
      // TODO: Figure out a way to support owned toOne relationships as well.
      return this.resolveDependency(builder, value, [], DependencySaveOrder.Before)
    } else if (isArray(value) && value.every(it => isFixture(it) || isFixtureBuilder(it))) {
      // We do assume that toMany relationships are owned.
      // TODO: Figure out a way to support non-owned toMany relationships as well.
      return value.map(it => this.resolveDependency(builder, it, [], DependencySaveOrder.After))
    } else if (isFunction(value)) {
      return value.call(this)
    } else {
      return value
    }
  }

  private resolveDependency<F extends AnyFixture>(owner: FixtureBuilder<AnyFixture>, value: F | FixtureBuilder<F> | (() => object) | object, args: fixtureInitArgs<F>, saveOrder: DependencySaveOrder = DependencySaveOrder.Before): object {
    if (isFixture(value)) {
      const builder = FixtureBuilder.for(value, this, args)
      const instance = this.getInstance(builder)
      this.addDependency(owner, builder, instance, saveOrder)
      return instance
    } else if (isFixtureBuilder(value)) {
      const instance = this.getInstance(value)
      this.addDependency(owner, value, instance, saveOrder)
      return instance
    } else {
      this.addDependency(owner, null, value, saveOrder)
      return value
    }
  }

  private addDependency<F extends AnyFixture>(owner: FixtureBuilder<AnyFixture>, builder: FixtureBuilder<F> | null, instance: object, saveOrder: DependencySaveOrder) {
    const deps = MapUtil.ensure(this.dependencies, owner, () => [])
    deps.push(new Dependency(
      this,
      builder,
      instance,
      saveOrder,
    ))
  }

  // #endregion

  // #region Save & delete

  public async saveInstance<F extends AnyFixture>(builder: FixtureBuilder<F>, instance?: fixtureInstance<F>): Promise<fixtureInstance<F>> {
    // If no instance given, build it now.
    instance ??= this.getInstance(builder)

    const dependenciesBefore = this.dependencies.get(builder)?.filter(it => it.runBefore) ?? []
    const dependenciesAfter = this.dependencies.get(builder)?.filter(it => it.runAfter) ?? []

    for (const dependency of dependenciesBefore) {
      await dependency.save()
    }

    const repository = this.entityManager.getRepository(builder.fixture.Entity)
    const saved = await repository.save(instance)
    Object.assign(instance, {...saved})

    for (const dependency of dependenciesAfter) {
      await dependency.save()
    }

    return instance
  }

  public async removeInstance<F extends AnyFixture>(builder: FixtureBuilder<F>, instance?: fixtureInstance<F>): Promise<void> {
    // If no instance given, build it now.
    instance ??= this.getInstance(builder)

    const repository = this.entityManager.getRepository(builder.fixture.Entity)
    await repository.remove(instance)
  }

  // #endregion

}