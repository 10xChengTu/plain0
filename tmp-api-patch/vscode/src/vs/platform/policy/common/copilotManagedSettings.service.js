
import { createDecorator } from '../../instantiation/common/instantiation.js';

const INativeManagedSettingsService = ( createDecorator("nativeManagedSettingsService"));
const IFileManagedSettingsService = ( createDecorator("fileManagedSettingsService"));

export { IFileManagedSettingsService, INativeManagedSettingsService };
