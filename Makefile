PACKAGE := pve-ups-panel
VERSION := $(shell dpkg-parsechangelog -l debian/changelog -S Version 2>/dev/null || echo 1.0.0)
DEB     := $(PACKAGE)_$(VERSION)_all.deb

.PHONY: deb install uninstall clean

deb:
	dpkg-buildpackage -us -uc -b -rfakeroot
	mv ../$(DEB) .
	@echo ""
	@echo "Built: $(DEB)"
	@echo "Install with: dpkg -i $(DEB)"

install: deb
	dpkg -i $(DEB)

uninstall:
	dpkg -r $(PACKAGE)

clean:
	rm -f *.deb *.buildinfo *.changes
	rm -rf debian/.debhelper debian/pve-ups-panel debian/files debian/debhelper-build-stamp
