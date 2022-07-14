import { DefaultConfigKey } from "renderer/config/default-configuration.config";
import { distinctUntilChanged, filter, map, Observable } from "rxjs";
import { ConfigurationService } from "./configuration.service";
import { getProperty } from "dot-prop";

export class I18nService {

   private static instance: I18nService;

   private readonly cache: Map<string, string>;

   private readonly LANG_CONFIG_KEY: DefaultConfigKey = "language";
   private readonly LANG_FALLBACK = "en-EN";

   private readonly configService: ConfigurationService;

   private dictionary: Object;

   public static getInstance(): I18nService{
      if(!I18nService.instance){ I18nService.instance = new I18nService(); }
      return I18nService.instance;
   }
   private constructor(){
      this.configService = ConfigurationService.getInstance();
      this.cache = new Map<string, string>();

      this.currentLanguage$.pipe(filter(l => !!l), distinctUntilChanged()).subscribe(lang => {
         this.cache.clear();
         this.dictionary = require(`../../../assets/jsons/translations/${lang}.json`);
      });
    }

   public getSupportedLanguages(): string[]{ return this.configService.get("supported_languages" as DefaultConfigKey); }
   public getFallbackLanguage(): string{ return this.LANG_FALLBACK; }

   public get currentLanguage(): string{ 
      return this.getSupportedLanguages().includes(this.configService.get(this.LANG_CONFIG_KEY)) ? this.configService.get(this.LANG_CONFIG_KEY) : this.LANG_FALLBACK; 
   }
   public get currentLanguage$(): Observable<string>{
      return this.configService.watch<string>("language" as DefaultConfigKey).pipe(map(l => this.getSupportedLanguages().includes(l) ? l : this.LANG_FALLBACK));
   }

   public setLanguage(lang: string){
      this.configService.set("language" as DefaultConfigKey, this.getSupportedLanguages().includes(lang) ? lang : this.LANG_FALLBACK);
   }

   public translate(translationKey: string): string{
      const cachedTranlation = this.cache.get(translationKey);
      if(!!cachedTranlation){ return cachedTranlation; }
      const tranlated = getProperty(this.dictionary, translationKey);
      tranlated && this.cache.set(translationKey, tranlated);
      return tranlated || translationKey;
   }









}