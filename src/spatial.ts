export interface QuadBox {
  x: number;
  y: number;
  width: number;
  height: number;
  id: string;
}

export class QuadTreeNode {
  bounds: QuadBox;
  capacity: number;
  items: QuadBox[];
  divided: boolean;
  nw: QuadTreeNode | null = null;
  ne: QuadTreeNode | null = null;
  sw: QuadTreeNode | null = null;
  se: QuadTreeNode | null = null;

  constructor(bounds: QuadBox, capacity = 4) {
    this.bounds = bounds;
    this.capacity = capacity;
    this.items = [];
    this.divided = false;
  }

  subdivide() {
    const { x, y, width, height } = this.bounds;
    const hw = width / 2;
    const hh = height / 2;
    this.nw = new QuadTreeNode({ x, y, width: hw, height: hh, id: '' }, this.capacity);
    this.ne = new QuadTreeNode({ x: x + hw, y, width: hw, height: hh, id: '' }, this.capacity);
    this.sw = new QuadTreeNode({ x, y: y + hh, width: hw, height: hh, id: '' }, this.capacity);
    this.se = new QuadTreeNode({ x: x + hw, y: y + hh, width: hw, height: hh, id: '' }, this.capacity);
    this.divided = true;
  }

  insert(item: QuadBox): boolean {
    if (!this.intersects(this.bounds, item)) return false;

    if (this.items.length < this.capacity && !this.divided) {
      this.items.push(item);
      return true;
    }

    if (!this.divided) {
      this.subdivide();
    }

    if (this.nw!.insert(item)) return true;
    if (this.ne!.insert(item)) return true;
    if (this.sw!.insert(item)) return true;
    if (this.se!.insert(item)) return true;

    return false;
  }

  queryRange(range: QuadBox, found: QuadBox[] = []): QuadBox[] {
    if (!this.intersects(this.bounds, range)) {
      return found;
    }

    for (const item of this.items) {
      if (this.intersects(item, range)) {
        found.push(item);
      }
    }

    if (this.divided) {
      this.nw!.queryRange(range, found);
      this.ne!.queryRange(range, found);
      this.sw!.queryRange(range, found);
      this.se!.queryRange(range, found);
    }

    return found;
  }

  private intersects(a: QuadBox, b: QuadBox): boolean {
    return !(b.x > a.x + a.width || b.x + b.width < a.x || b.y > a.y + a.height || b.y + b.height < a.y);
  }
}