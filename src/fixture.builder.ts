import { tz } from 'typeorm-zod'
import { AnyConstructor, isFunction, objectEntries, objectKeys, Primitive } from 'ytil'
import { fixture } from './fixture.factory'
import { FixtureProvider } from './fixture.provider'
import {
  AnyFixture,
  FixtureBuildContext,
  FixtureBuilderOf,
  fixtureInitArgs,
  fixtureInstance,
  FixtureModifierInput,
} from './types'

export class FixtureBuilder<F extends AnyFixture> {

  private constructor(
    public readonly fixture: F,
    private readonly provider: FixtureProvider,
    private readonly initArgs: fixtureInitArgs<F>,
  ) {}

  public static for<F extends AnyFixture>(fixture: F, provider: FixtureProvider, initArgs: fixtureInitArgs<F>): FixtureBuilderOf<F> {
    const builder = new FixtureBuilder(fixture, provider, initArgs)
    const columns = tz.collectSchema(fixture.Entity).columns

    // Define a setter for each attribute of the entity.
    const attributes = objectKeys(columns).filter(it => typeof it === 'string')
    for (const attribute of attributes) {
      builder.defineSetter(attribute)
    }

    // Define additional modifiers.
    for (const [name, modifier] of objectEntries(fixture.modifiers ?? {})) {
      builder.defineModifier(name, modifier)
    }

    // Run the initializer.
    builder.init()

    return builder as FixtureBuilderOf<F>
  }

  public _modifiers: Array<[FixtureModifierInput<AnyConstructor, any[]>, any[], boolean]> = []
  private _inInit: boolean = false

  private init() {
    if (this.fixture.init == null) { return }

    const inputs = this.fixture.init(...this.initArgs as [])
    this._inInit = true
    for (const [attribute, input] of objectEntries(inputs)) {
      const modifierName = `with_${attribute}`
      const modifier = (this as any)[modifierName]
      if (!isFunction(modifier)) {
        console.warn(`No modifier found for attribute ${attribute} of fixture ${this.fixture.Entity.name}. Did you forget to define a setter for it?`)
        continue
      }

      modifier.call(this, input, true)
    }
    this._inInit = false
  }

  private defineSetter(attribute: string) {
    const setterName = `with_${attribute}`
    this.defineModifier(
      setterName,
      function (instance, value) {
        Object.assign(instance, {
          [attribute]: this.resolve(value)
        })
      }
    )
  }

  private defineModifier(name: string, modifier: FixtureModifierInput<AnyConstructor, any[]>) {
    Object.defineProperty(this, name, {
      value: (...args: any[]) => {
        this._modifiers.push([modifier, args, this._inInit])
        return this
      },
    })
  }

  public applyModifiers(instance: fixtureInstance<F>, context: FixtureBuildContext, includeInitModifiers: boolean) {
    for (const [modifier, args, init] of this._modifiers) {
      if (!includeInitModifiers && init) { continue }
      modifier.call(context, instance, ...args)
    }
  }

  public key(instance: fixtureInstance<F>): Primitive | undefined {
    return this.fixture.key?.call(this.provider, instance)
  }

  public build() {
    return this.provider.getInstance(this)
  }

  public async save(): Promise<fixtureInstance<F>> {
    return await this.provider.saveInstance(this)
  }

  public async remove(): Promise<void> {
    await this.provider.removeInstance(this)
  }

}