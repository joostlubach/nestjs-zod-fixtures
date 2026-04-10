import { FixtureBuilder } from './fixture.builder'
import { FixtureProvider } from './fixture.provider'
import { AnyFixture, DependencySaveOrder, fixtureInstance } from './types'

export class Dependency<F extends AnyFixture> {

  constructor(
    private readonly provider: FixtureProvider,
    private readonly builder: FixtureBuilder<F> | null,
    private readonly instance: object,
    private readonly saveOrder: DependencySaveOrder,
  ) {}

  public get runBefore() {
    return this.saveOrder === DependencySaveOrder.Before
  }

  public get runAfter() {
    return this.saveOrder === DependencySaveOrder.After
  }

  public async save() {
    if (this.builder != null) {
      await this.provider.saveInstance(this.builder, this.instance as fixtureInstance<F>)
    } else {
      await this.provider.entityManager.save(this.instance)
    }
  }

}