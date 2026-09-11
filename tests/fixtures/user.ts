export class User {
  private id: number;
  private name: string | null;

  constructor(id = 0, name: string | null = null) {
    this.id = id;
    this.name = name;
  }

  getId(): number {
    return this.id;
  }

  setId(id: number): void {
    this.id = id;
  }

  getName(): string | null {
    return this.name;
  }

  setName(name: string | null): void {
    this.name = name;
  }
}
