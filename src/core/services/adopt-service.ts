import { SkillsManagerError } from '../../shared/errors.js';

export class AdoptService {
  adopt(_view: string, _skill: string, _alsoConsumers: readonly string[] = []) {
    throw new SkillsManagerError('adopt_removed', 'Adopt from hub views/ is removed. Place the skill under hub skills/ then distribute.');
  }
}
