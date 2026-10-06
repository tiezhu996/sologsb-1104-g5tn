export type FurnitureName = '圈椅' | '条案' | '架子床' | '官帽椅' | '方桌' | '柜架'

export interface Furniture {
  id: string
  jointTypeId: string
  name: FurnitureName
  era: string
  position: string
  loadNote: string
  /** 校样台家具说明所引用的关键构件（出榫件），断链校验依据 */
  memberId?: string
  schemaRev?: number
}
