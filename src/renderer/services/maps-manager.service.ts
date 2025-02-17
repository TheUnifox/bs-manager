import { LinkContentModal } from "renderer/components/modal/modal-types/link-contents-modal.component";
import { UnlinkContentsModal } from "renderer/components/modal/modal-types/unlink-contents-modal.component";
import { Subject, Observable, of, lastValueFrom, Subscription, throwError } from "rxjs";
import { BSVersion } from "shared/bs-version.interface";
import { BsmLocalMapsProgress, BsmLocalMap } from "shared/models/maps/bsm-local-map.interface";
import { IpcService } from "./ipc.service";
import { ModalExitCode, ModalService } from "./modale.service";
import { DeleteMapsModal } from "renderer/components/modal/modal-types/delete-maps-modal.component";
import { ProgressBarService } from "./progress-bar.service";
import { NotificationService } from "./notification.service";
import { ConfigurationService } from "./configuration.service";
import { map, last, catchError, filter, distinctUntilChanged } from "rxjs/operators";
import { ProgressionInterface } from "shared/models/progress-bar";
import { FolderLinkState, VersionFolderLinkerService } from "./version-folder-linker.service";
import { SongDetails } from "shared/models/maps";
import { Progression } from "main/helpers/fs.helpers";
import { DeleteDuplicateMapsModal } from "renderer/components/modal/modal-types/delete-duplicate-maps-modal.component";
import equal from "fast-deep-equal";

export class MapsManagerService {
    private static instance: MapsManagerService;

    public static getInstance(): MapsManagerService {
        if (!MapsManagerService.instance) {
            MapsManagerService.instance = new MapsManagerService();
        }
        return MapsManagerService.instance;
    }

    public static readonly REMEMBER_CHOICE_DELETE_MAP_KEY = "not-confirm-delete-map";
    public static readonly RELATIVE_MAPS_FOLDER = window.electron.path.join("Beat Saber_Data", "CustomLevels");

    private readonly ipcService: IpcService;
    private readonly modal: ModalService;
    private readonly progressBar: ProgressBarService;
    private readonly notifications: NotificationService;
    private readonly config: ConfigurationService;
    private readonly linker: VersionFolderLinkerService;

    private readonly lastLinkedVersion$: Subject<BSVersion> = new Subject();
    private readonly lastUnlinkedVersion$: Subject<BSVersion> = new Subject();

    private readonly lastImportedMap$: Subject<{ version: BSVersion, map: BsmLocalMap }> = new Subject();

    private constructor() {
        this.ipcService = IpcService.getInstance();
        this.modal = ModalService.getInstance();
        this.progressBar = ProgressBarService.getInstance();
        this.notifications = NotificationService.getInstance();
        this.config = ConfigurationService.getInstance();
        this.linker = VersionFolderLinkerService.getInstance();
    }

    public getMaps(version?: BSVersion): Observable<BsmLocalMapsProgress> {
        return this.ipcService.sendV2("load-version-maps", version, { loaded: 0, total: 0, maps: [] });
    }

    public async versionHaveMapsLinked(version: BSVersion): Promise<boolean> {
        return this.linker.isVersionFolderLinked(version, MapsManagerService.RELATIVE_MAPS_FOLDER).toPromise();
    }

    public async linkVersion(version: BSVersion): Promise<boolean> {
        const modalRes = await this.modal.openModal(LinkContentModal, { data: { version, contentType: "maps" } });

        if (modalRes.exitCode !== ModalExitCode.COMPLETED) {
            return Promise.resolve(false);
        }

        return this.linker.linkVersionFolder({
            version,
            relativeFolder: MapsManagerService.RELATIVE_MAPS_FOLDER,
            options: { keepContents: true },
        });
    }

    public async unlinkVersion(version: BSVersion): Promise<boolean> {
        const modalRes = await this.modal.openModal(UnlinkContentsModal, { data: { version, contentType: "maps" } });

        if (modalRes.exitCode !== ModalExitCode.COMPLETED) {
            return Promise.resolve(false);
        }

        return this.linker.unlinkVersionFolder({
            version,
            relativeFolder: MapsManagerService.RELATIVE_MAPS_FOLDER,
            options: { keepContents: !!modalRes.data },
        });
    }

    public async deleteMaps(maps: BsmLocalMap[], version?: BSVersion): Promise<boolean> {
        const versionLinked = !version || (await this.versionHaveMapsLinked(version));

        const askModal = maps.length > 1 || !this.config.get<boolean>(MapsManagerService.REMEMBER_CHOICE_DELETE_MAP_KEY);

        if (askModal) {
            const modalRes = await this.modal.openModal(DeleteMapsModal, {data: { linked: versionLinked, maps }});
            if (modalRes.exitCode !== ModalExitCode.COMPLETED) {
                return false;
            }
        }

        const showProgressBar = this.progressBar.require();

        const progress$ = this.ipcService.sendV2("delete-maps", maps ).pipe(map(progress => (progress.deleted / progress.total) * 100));

        if (showProgressBar) {
            this.progressBar.show(progress$);
        }

        progress$.toPromise().finally(() => this.progressBar.hide());

        return progress$
            .pipe(
                last(),
                map(() => true),
                catchError(() => of(false))
            )
            .toPromise()
            .catch(() => false);
    }

    public async exportMaps(version: BSVersion, maps?: BsmLocalMap[]): Promise<void> {
        if (!this.progressBar.require()) {
            return;
        }

        const resFile = await lastValueFrom(this.ipcService.sendV2("save-file", { filename: version ? `${version.BSVersion}Maps` : "Maps", filters: [{ name: "zip", extensions: ["zip"] }]})).catch(() => null as string);

        if (!resFile) {
            return;
        }

        const exportProgress$: Observable<ProgressionInterface> = this.ipcService.sendV2("export-maps", { version, maps, outPath: resFile }).pipe(
            map(p => {
                return { progression: (p.current / p.total) * 100, label: `${p.current} / ${p.total}` } as ProgressionInterface;
            })
        );

        this.progressBar.show(exportProgress$);

        await exportProgress$
            .toPromise()
            .catch(e => {
                this.notifications.notifyError({ title: "notifications.types.error", desc: e.message });
            })
            .then(() => {
                // TODO TRANSLATE
                this.notifications.notifySuccess({ title: "Export terminé 🎉", duration: 3000 });
                this.progressBar.complete();
                this.progressBar.hide();
            });
    }

    public deleteDuplicateMaps(maps: BsmLocalMap[]): Observable<Progression> {
        const hashMap = Object.groupBy(maps, m => m.hash);
        const mapsToDelete: BsmLocalMap[] = [];

        for (const maps of Object.values(hashMap)) {
            if(!Array.isArray(maps)){ continue; }
            maps.sort((a, b) => b.path.length - a.path.length).pop(); // The longest paths are most likely to be the duplicate ones (path: '../Awesome maps (copy)')
            mapsToDelete.push(...maps);
        }

        if(mapsToDelete.length === 0){
            this.notifications.notifySuccess({ title: "notifications.maps.no-duplicates-maps.title", desc: "notifications.maps.no-duplicates-maps.msg", duration: 4000 });
            return of({ current: 0, total: 0 });
        }

        if(!this.progressBar.require()){
            return throwError(() => new Error("Progress bar is required to delete duplicate maps"));
        }

        return new Observable<Progression>(obs => {
            let sub: Subscription;
            (async () => {
                const modalRes = await this.modal.openModal(DeleteDuplicateMapsModal, { data: { maps: mapsToDelete } });

                if(modalRes.exitCode !== ModalExitCode.COMPLETED){
                    throw new Error("Operation to delete duplicate maps as been canceled by the user");
                }

                const progress$: Observable<Progression> = this.ipcService.sendV2("delete-maps", mapsToDelete).pipe(map(p => ({ total: p.total, current: p.deleted })));

                this.progressBar.show(progress$);
                sub = progress$.subscribe(obs);

                await lastValueFrom(progress$);
            })()
            .then(() => this.notifications.notifySuccess({ title: "notifications.maps.duplicates-maps-deleted.title", desc: "notifications.maps.duplicates-maps-deleted.msg", duration: 4000 }))
            .catch(e => obs.error(e))
            .finally(() => obs.complete());

            return () => {
                if(sub){
                    this.progressBar.hide();
                    sub.unsubscribe();
                }
            }
        })
    }

    public importMaps(paths: string[], version?: BSVersion): Observable<Progression<BsmLocalMap>> {
        if(!this.progressBar.require()){
            return throwError(() => new Error("Another operation is already in progress (importMaps)"));
        }

        return new Observable<Progression<BsmLocalMap>>(obs => {
            const subs: Subscription[] = [];
            (async () => {
                const import$ = this.ipcService.sendV2("bs-maps.import-maps", { paths, version });

                this.progressBar.show(import$.pipe(
                    catchError(() => of()),
                    map(progress => ({
                        progression: (progress.current / progress.total) * 100,
                        label: progress.data?.songDetails?.name
                    } as ProgressionInterface))
                ));

                subs.push(import$.subscribe(obs));

                subs.push(import$.pipe(catchError(() => of()), map(progress => progress?.data), filter(Boolean), distinctUntilChanged((a, b) => equal(a, b))).subscribe({ next: map => {
                    this.lastImportedMap$.next({ version, map });
                }}));

                return lastValueFrom(import$);
            })()
            .then(progress => {
                if (progress.current === progress.total) {
                    this.notifications.notifySuccess({
                        title: "notifications.maps.import-map.titles.success",
                        desc: "notifications.maps.import-map.msgs.success",
                    });
                } else if (progress.current > 0) {
                    this.notifications.notifySuccess({
                        title: "notifications.maps.import-map.titles.success",
                        desc: "notifications.maps.import-map.msgs.some-success",
                    });
                }
            }).catch(err => {
                this.notifications.notifyError({
                    title: "notifications.maps.import-map.titles.error",
                    desc: ["invalid-zip"].includes(err?.code)
                        ? `notifications.maps.import-map.msgs.${err.code}`
                        : "notifications.maps.import-map.msgs.unknown"
                });
                obs.error(err);
            })
            .finally(() => obs.complete());

            return () => {
                if(subs.length){
                    this.progressBar.hide();
                    subs.forEach(s => s.unsubscribe());
                }
            }
        });
    }

    public getMapsInfoFromHashs(hashs: string[]): Observable<SongDetails[]> {
        return this.ipcService.sendV2("get-maps-info-from-cache", hashs);
    }

    public async isDeepLinksEnabled(): Promise<boolean> {
        return lastValueFrom(this.ipcService.sendV2("is-map-deep-links-enabled"));
    }

    public async enableDeepLink(): Promise<boolean> {
        return lastValueFrom(this.ipcService.sendV2("register-maps-deep-link"));
    }

    public async disableDeepLink(): Promise<boolean> {
        return lastValueFrom(this.ipcService.sendV2("unregister-maps-deep-link"));
    }

    public get versionLinked$(): Observable<BSVersion> {
        return this.lastLinkedVersion$.asObservable();
    }

    public get versionUnlinked$(): Observable<BSVersion> {
        return this.lastUnlinkedVersion$.asObservable();
    }

    public $onMapImported(version: BSVersion): Observable<BsmLocalMap> {
        return this.lastImportedMap$.pipe(filter(newMap => equal(newMap.version, version)), map(m => m.map));
    }

    public $mapsFolderLinkState(version: BSVersion): Observable<FolderLinkState> {
        return this.linker.$folderLinkedState(version, MapsManagerService.RELATIVE_MAPS_FOLDER);
    }
}
