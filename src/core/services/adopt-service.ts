import { SkillsManagerError } from '../../shared/errors.js';
import { parseConsumers } from '../../shared/validation.js';

export class AdoptService {
  adopt(view: string, _skill: string, _alsoConsumers: readonly string[] = []) {
    parseConsumers([view]);
    throw new SkillsManagerError('adopt_removed', 'Adopt from hub views/ is removed. Place the skill under hub skills/ then distribute.');
  }
}
